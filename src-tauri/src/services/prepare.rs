use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use tauri::{AppHandle, Emitter};

use crate::{
    api::dto::{
        CancelResponse, PackagePrepareFinalizeResponse, PackagePrepareStartResponse,
        PrepareFileProgress, PrepareFileStatusDto, PrepareProgressSummary,
        PrepareSessionStatusDto, SendPrepareProgressEvent,
    },
    iroh::{ImportPhase, SourceFile},
    state::{
        IrohAppState, PrepareFileLifecycleState, PrepareFileState, PrepareLifecycleState,
        PrepareSessionMeta,
    },
    utils::{files::build_source_files, ids::next_id},
};

const SEND_PREPARE_PROGRESS_EVENT: &str = "send:prepare-progress";
const SEND_PREPARE_COMPLETED_EVENT: &str = "send:prepare-completed";
const SEND_PREPARE_ERROR_EVENT: &str = "send:prepare-error";
const SEND_PREPARE_EMIT_MS: u64 = 50;

#[derive(Clone)]
struct PrepareFileProgressUpdate {
    file_id: String,
    name: String,
    path: String,
    status: PrepareFileStatusDto,
    processed_bytes: u64,
    total_bytes: u64,
    error: Option<String>,
}

struct PrepareProgressBatch {
    changed_file_ids: Vec<String>,
    files: Vec<PrepareFileProgress>,
}

struct PrepareProgressBatcher {
    latest_by_file: HashMap<String, PrepareFileProgress>,
    changed_file_id_set: HashSet<String>,
    changed_file_ids: Vec<String>,
}

impl PrepareProgressBatcher {
    fn new() -> Self {
        Self {
            latest_by_file: HashMap::new(),
            changed_file_id_set: HashSet::new(),
            changed_file_ids: Vec::new(),
        }
    }

    fn push_update(&mut self, update: PrepareFileProgressUpdate) {
        self.latest_by_file.insert(
            update.file_id.clone(),
            PrepareFileProgress {
                file_id: update.file_id.clone(),
                name: update.name,
                path: update.path,
                status: update.status,
                processed_bytes: update.processed_bytes,
                total_bytes: update.total_bytes,
                error: update.error,
            },
        );
        if self.changed_file_id_set.insert(update.file_id.clone()) {
            self.changed_file_ids.push(update.file_id);
        }
    }

    fn flush(&mut self) -> PrepareProgressBatch {
        let changed_file_ids = std::mem::take(&mut self.changed_file_ids);
        self.changed_file_id_set.clear();
        let files = changed_file_ids
            .iter()
            .filter_map(|file_id| self.latest_by_file.get(file_id).cloned())
            .collect::<Vec<_>>();

        PrepareProgressBatch {
            changed_file_ids,
            files,
        }
    }

    fn has_pending(&self) -> bool {
        !self.changed_file_ids.is_empty()
    }
}

pub async fn package_prepare_start(
    files: Vec<String>,
    roots: Option<Vec<String>>,
    app: AppHandle,
    state: &IrohAppState,
) -> Result<PackagePrepareStartResponse, String> {
    let source_files = build_source_files(files, roots)?;
    if source_files.is_empty() {
        return Err("at least one file is required".to_string());
    }

    let prepare_session_id = next_id("prepare-session");
    let package_id = next_id("pkg");
    let file_states = source_files
        .iter()
        .enumerate()
        .map(|(idx, file)| build_initial_file_state(idx, file))
        .collect::<Vec<_>>();

    state.prepare_registry.insert_session(
        prepare_session_id.clone(),
        PrepareSessionMeta::with_files(package_id.clone(), file_states),
    )?;

    let worker_session_id = prepare_session_id.clone();
    let worker_package_id = package_id.clone();
    let registry = state.prepare_registry.clone();
    let app_handle = app.clone();
    let node = {
        let guard = state.node.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "iroh node not initialized".to_string())?
    };

    let task = tauri::async_runtime::spawn(async move {
        run_prepare_worker(
            app_handle,
            registry,
            node,
            worker_session_id,
            worker_package_id,
            source_files,
        )
        .await;
    });

    state
        .prepare_registry
        .register_task(prepare_session_id.clone(), task)?;

    Ok(PackagePrepareStartResponse {
        prepare_session_id,
        package_id,
    })
}

pub async fn package_prepare_finalize(
    prepare_session_id: String,
    state: &IrohAppState,
) -> Result<PackagePrepareFinalizeResponse, String> {
    let session = state
        .prepare_registry
        .get_session(&prepare_session_id)
        .ok_or_else(|| format!("prepare session not found: {prepare_session_id}"))?;

    let lifecycle = state
        .prepare_registry
        .get_lifecycle_state(&prepare_session_id)
        .ok_or_else(|| format!("prepare session lifecycle not found: {prepare_session_id}"))?;

    let all_files_terminal = session.files.iter().all(|file| {
        matches!(
            file.status,
            PrepareFileLifecycleState::Completed
                | PrepareFileLifecycleState::Failed
                | PrepareFileLifecycleState::Cancelled
        )
    });
    let has_imported_files = !session.imported_hashes.is_empty();

    if !(lifecycle == PrepareLifecycleState::Completed
        || (all_files_terminal && has_imported_files))
    {
        return Err(format!(
            "prepare session {prepare_session_id} is not ready to finalize"
        ));
    }

    if !has_imported_files {
        return Err(format!(
            "prepare session {prepare_session_id} has no imported files"
        ));
    }

    let node = {
        let guard = state.node.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "iroh node not initialized".to_string())?
    };

    let created = node
        .create_collection_ticket_from_hashes(&session.imported_hashes)
        .await
        .map_err(|err| err.to_string())?;

    let send_session_id = next_id("send-session");
    for hash in created.served_hashes {
        state
            .registry
            .map_hash_to_session(hash, send_session_id.clone())?;
    }

    state.registry.insert_session(
        send_session_id.clone(),
        crate::state::SessionMeta {
            package_id: session.package_id.clone(),
            total_bytes: session
                .files
                .iter()
                .filter(|file| file.status == PrepareFileLifecycleState::Completed)
                .map(|file| file.total_bytes)
                .sum(),
        },
    )?;

    state.prepare_registry.cleanup_session(&prepare_session_id);

    Ok(PackagePrepareFinalizeResponse {
        session_id: send_session_id,
        package_id: session.package_id,
        ticket: created.ticket,
    })
}

pub fn package_prepare_cancel(
    prepare_session_id: String,
    state: &IrohAppState,
) -> Result<CancelResponse, String> {
    let ok = state.prepare_registry.request_cancel(&prepare_session_id)?;
    Ok(CancelResponse { ok })
}

pub fn package_prepare_remove_file(
    prepare_session_id: String,
    file_id: String,
    state: &IrohAppState,
) -> Result<CancelResponse, String> {
    let ok = state
        .prepare_registry
        .request_remove_file(&prepare_session_id, &file_id)?;
    Ok(CancelResponse { ok })
}

async fn run_prepare_worker(
    app: AppHandle,
    registry: crate::state::PrepareRegistry,
    node: std::sync::Arc<crate::iroh::IrohNode>,
    prepare_session_id: String,
    package_id: String,
    source_files: Vec<SourceFile>,
) {
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<
        PrepareFileProgressUpdate,
    >();

    let _ = registry.transition_state(&prepare_session_id, PrepareLifecycleState::Running);

    let importer_registry = registry.clone();
    let importer_session_id = prepare_session_id.clone();
    let mut importer = tauri::async_runtime::spawn(async move {
        for (idx, file) in source_files.into_iter().enumerate() {
            let file_id = format!("f{idx}");

            if importer_registry.is_cancel_requested(&importer_session_id)
                || importer_registry
                    .take_remove_file_request(&importer_session_id, &file_id)
                    .unwrap_or(false)
            {
                let _ = importer_registry.update_session(&importer_session_id, |session| {
                    if let Some(item) = session.files.iter_mut().find(|entry| entry.file_id == file_id)
                    {
                        item.status = PrepareFileLifecycleState::Cancelled;
                        item.error = None;
                    }
                });
                if let Some(snapshot) = importer_registry.get_session(&importer_session_id) {
                    if let Some(item) = snapshot.files.into_iter().find(|entry| entry.file_id == file_id) {
                        let _ = progress_tx.send(file_state_to_progress_update(item));
                    }
                }
                continue;
            }

            let _ = importer_registry.update_session(&importer_session_id, |session| {
                if let Some(item) = session.files.iter_mut().find(|entry| entry.file_id == file_id) {
                    item.status = PrepareFileLifecycleState::Importing;
                    item.error = None;
                }
            });
            if let Some(snapshot) = importer_registry.get_session(&importer_session_id) {
                if let Some(item) = snapshot.files.into_iter().find(|entry| entry.file_id == file_id) {
                    let _ = progress_tx.send(file_state_to_progress_update(item));
                }
            }

            let progress_registry = importer_registry.clone();
            let progress_session_id = importer_session_id.clone();
            let progress_file_id = file_id.clone();
            let progress_tx_clone = progress_tx.clone();
            let import_result = node
                .import_file_with_progress(&file, move |phase, processed, total| {
                    let total_bytes = total.unwrap_or(0);
                    let _ = progress_registry.update_session(&progress_session_id, |session| {
                        if let Some(item) =
                            session.files.iter_mut().find(|entry| entry.file_id == progress_file_id)
                        {
                            let next_status = match phase {
                                ImportPhase::Importing => PrepareFileLifecycleState::Importing,
                                ImportPhase::Verifying => PrepareFileLifecycleState::Verifying,
                            };
                            if item.status != next_status {
                                item.processed_bytes = 0;
                            }
                            item.status = next_status;
                            item.processed_bytes = processed;
                            if total_bytes > 0 {
                                item.total_bytes = total_bytes;
                            }
                        }
                    });

                    if let Some(snapshot) = progress_registry.get_session(&progress_session_id) {
                        if let Some(item) = snapshot
                            .files
                            .into_iter()
                            .find(|entry| entry.file_id == progress_file_id)
                        {
                            let _ = progress_tx_clone.send(file_state_to_progress_update(item));
                        }
                    }

                    let removed = progress_registry
                        .take_remove_file_request(&progress_session_id, &progress_file_id)
                        .unwrap_or(false);
                    !(removed || progress_registry.is_cancel_requested(&progress_session_id))
                })
                .await;

            match import_result {
                Ok(hash) => {
                    let mut cancelled = importer_registry.is_cancel_requested(&importer_session_id);
                    cancelled = cancelled
                        || importer_registry
                            .take_remove_file_request(&importer_session_id, &file_id)
                            .unwrap_or(false);

                    if cancelled {
                        let _ = importer_registry.update_session(&importer_session_id, |session| {
                            if let Some(item) = session.files.iter_mut().find(|entry| entry.file_id == file_id)
                            {
                                item.status = PrepareFileLifecycleState::Cancelled;
                                item.error = None;
                                item.hash = None;
                            }
                        });
                    } else {
                        let _ = importer_registry.update_session(&importer_session_id, |session| {
                            if let Some(item) = session.files.iter_mut().find(|entry| entry.file_id == file_id)
                            {
                                item.status = PrepareFileLifecycleState::Completed;
                                item.error = None;
                                item.hash = Some(hash.clone());
                                session
                                    .imported_hashes
                                    .push((item.name.clone(), hash.clone()));
                            }
                        });
                    }
                }
                Err(err) => {
                    let message = err.to_string();
                    let cancelled = message.contains("cancelled")
                        || importer_registry.is_cancel_requested(&importer_session_id)
                        || importer_registry
                            .take_remove_file_request(&importer_session_id, &file_id)
                            .unwrap_or(false);

                    let _ = importer_registry.update_session(&importer_session_id, |session| {
                        if let Some(item) = session.files.iter_mut().find(|entry| entry.file_id == file_id) {
                            if cancelled {
                                item.status = PrepareFileLifecycleState::Cancelled;
                                item.error = None;
                            } else {
                                item.status = PrepareFileLifecycleState::Failed;
                                item.error = Some(message.clone());
                            }
                        }
                    });
                }
            }

            if let Some(snapshot) = importer_registry.get_session(&importer_session_id) {
                if let Some(item) = snapshot.files.into_iter().find(|entry| entry.file_id == file_id) {
                    let _ = progress_tx.send(file_state_to_progress_update(item));
                }
            }

            if importer_registry.is_cancel_requested(&importer_session_id) {
                let _ = importer_registry.update_session(&importer_session_id, |session| {
                    for item in &mut session.files {
                        if matches!(
                            item.status,
                            PrepareFileLifecycleState::Queued
                                | PrepareFileLifecycleState::Importing
                                | PrepareFileLifecycleState::Verifying
                        ) {
                            item.status = PrepareFileLifecycleState::Cancelled;
                            item.error = None;
                        }
                    }
                });
                break;
            }
        }
    });

    let mut ticker = tokio::time::interval(Duration::from_millis(SEND_PREPARE_EMIT_MS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut batcher = PrepareProgressBatcher::new();

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if batcher.has_pending() {
                    let batch = batcher.flush();
                    let _ = emit_prepare_progress_event(&app, &registry, &prepare_session_id, &package_id, batch, false);
                }
            }
            maybe_update = progress_rx.recv() => {
                match maybe_update {
                    Some(update) => batcher.push_update(update),
                    None => break,
                }
            }
            result = &mut importer => {
                let _ = result;
                break;
            }
        }
    }

    while let Ok(update) = progress_rx.try_recv() {
        batcher.push_update(update);
    }

    let session = registry.get_session(&prepare_session_id);
    let Some(session) = session else {
        return;
    };

    let completed_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Completed)
        .count();
    let failed_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Failed)
        .count();
    let cancelled_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Cancelled)
        .count();

    let terminal = if registry.is_cancel_requested(&prepare_session_id) {
        PrepareLifecycleState::Cancelled
    } else if completed_files > 0 {
        PrepareLifecycleState::Completed
    } else if failed_files > 0 || cancelled_files == session.files.len() {
        PrepareLifecycleState::Failed
    } else {
        PrepareLifecycleState::Failed
    };

    let _ = registry.transition_state(&prepare_session_id, terminal);

    let terminal_batch = if batcher.has_pending() {
        batcher.flush()
    } else {
        PrepareProgressBatch {
            changed_file_ids: session
                .files
                .iter()
                .map(|file| file.file_id.clone())
                .collect::<Vec<_>>(),
            files: session
                .files
                .iter()
                .cloned()
                .map(file_state_to_progress)
                .collect::<Vec<_>>(),
        }
    };

    let _ = emit_prepare_progress_event(
        &app,
        &registry,
        &prepare_session_id,
        &package_id,
        terminal_batch,
        true,
    );

    match terminal {
        PrepareLifecycleState::Completed => {
            let _ = app.emit(
                SEND_PREPARE_COMPLETED_EVENT,
                serde_json::json!({
                    "prepareSessionId": prepare_session_id,
                    "packageId": package_id,
                }),
            );
        }
        PrepareLifecycleState::Cancelled | PrepareLifecycleState::Failed => {
            let _ = app.emit(
                SEND_PREPARE_ERROR_EVENT,
                serde_json::json!({
                    "prepareSessionId": prepare_session_id,
                    "packageId": package_id,
                    "status": lifecycle_to_dto(terminal),
                }),
            );
        }
        _ => {}
    }
}

fn build_initial_file_state(index: usize, file: &SourceFile) -> PrepareFileState {
    let total_bytes = std::fs::metadata(&file.path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    PrepareFileState {
        file_id: format!("f{index}"),
        name: file.name.clone(),
        path: file.path.display().to_string(),
        status: PrepareFileLifecycleState::Queued,
        processed_bytes: 0,
        total_bytes,
        error: None,
        hash: None,
    }
}

fn file_state_to_progress_update(file: PrepareFileState) -> PrepareFileProgressUpdate {
    PrepareFileProgressUpdate {
        file_id: file.file_id,
        name: file.name,
        path: file.path,
        status: file_status_to_dto(file.status),
        processed_bytes: file.processed_bytes,
        total_bytes: file.total_bytes,
        error: file.error,
    }
}

fn file_state_to_progress(file: PrepareFileState) -> PrepareFileProgress {
    PrepareFileProgress {
        file_id: file.file_id,
        name: file.name,
        path: file.path,
        status: file_status_to_dto(file.status),
        processed_bytes: file.processed_bytes,
        total_bytes: file.total_bytes,
        error: file.error,
    }
}

fn file_status_to_dto(status: PrepareFileLifecycleState) -> PrepareFileStatusDto {
    match status {
        PrepareFileLifecycleState::Queued => PrepareFileStatusDto::Queued,
        PrepareFileLifecycleState::Importing => PrepareFileStatusDto::Importing,
        PrepareFileLifecycleState::Verifying => PrepareFileStatusDto::Verifying,
        PrepareFileLifecycleState::Completed => PrepareFileStatusDto::Completed,
        PrepareFileLifecycleState::Failed => PrepareFileStatusDto::Failed,
        PrepareFileLifecycleState::Cancelled => PrepareFileStatusDto::Cancelled,
    }
}

fn lifecycle_to_dto(status: PrepareLifecycleState) -> PrepareSessionStatusDto {
    match status {
        PrepareLifecycleState::Queued => PrepareSessionStatusDto::Queued,
        PrepareLifecycleState::Running => PrepareSessionStatusDto::Running,
        PrepareLifecycleState::Completed => PrepareSessionStatusDto::Completed,
        PrepareLifecycleState::Failed => PrepareSessionStatusDto::Failed,
        PrepareLifecycleState::Cancelled => PrepareSessionStatusDto::Cancelled,
    }
}

fn emit_prepare_progress_event(
    app: &AppHandle,
    registry: &crate::state::PrepareRegistry,
    prepare_session_id: &str,
    package_id: &str,
    batch: PrepareProgressBatch,
    done: bool,
) -> Result<(), String> {
    let mut sequence = 0_u64;
    let _ = registry.update_session(prepare_session_id, |session| {
        session.emit_sequence = session.emit_sequence.saturating_add(1);
        sequence = session.emit_sequence;
    });

    let session = registry
        .get_session(prepare_session_id)
        .ok_or_else(|| format!("prepare session not found: {prepare_session_id}"))?;
    let status = registry
        .get_lifecycle_state(prepare_session_id)
        .ok_or_else(|| format!("prepare session lifecycle not found: {prepare_session_id}"))?;

    let completed_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Completed)
        .count() as u64;
    let failed_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Failed)
        .count() as u64;
    let cancelled_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Cancelled)
        .count() as u64;
    let total_files = session.files.len() as u64;
    let processed_bytes = session
        .files
        .iter()
        .map(|file| file.processed_bytes)
        .sum::<u64>();
    let total_bytes = session.files.iter().map(|file| file.total_bytes).sum::<u64>();

    let payload = SendPrepareProgressEvent {
        prepare_session_id: prepare_session_id.to_string(),
        package_id: package_id.to_string(),
        status: lifecycle_to_dto(status),
        summary: PrepareProgressSummary {
            total_files,
            completed_files,
            failed_files,
            cancelled_files,
            processed_bytes,
            total_bytes,
        },
        files: batch.files,
        sequence,
        done,
        changed_file_ids: batch.changed_file_ids,
    };

    app.emit(SEND_PREPARE_PROGRESS_EVENT, payload)
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batcher_coalesces_latest_update_per_file_per_tick() {
        let mut batcher = PrepareProgressBatcher::new();
        batcher.push_update(PrepareFileProgressUpdate {
            file_id: "f1".to_string(),
            name: "a.txt".to_string(),
            path: "/tmp/a.txt".to_string(),
            status: PrepareFileStatusDto::Importing,
            processed_bytes: 10,
            total_bytes: 100,
            error: None,
        });
        batcher.push_update(PrepareFileProgressUpdate {
            file_id: "f1".to_string(),
            name: "a.txt".to_string(),
            path: "/tmp/a.txt".to_string(),
            status: PrepareFileStatusDto::Importing,
            processed_bytes: 55,
            total_bytes: 100,
            error: None,
        });
        batcher.push_update(PrepareFileProgressUpdate {
            file_id: "f2".to_string(),
            name: "b.txt".to_string(),
            path: "/tmp/b.txt".to_string(),
            status: PrepareFileStatusDto::Queued,
            processed_bytes: 0,
            total_bytes: 200,
            error: None,
        });

        let flushed = batcher.flush();
        assert_eq!(flushed.changed_file_ids, vec!["f1".to_string(), "f2".to_string()]);
        assert_eq!(flushed.files.len(), 2);
        assert_eq!(flushed.files[0].processed_bytes, 55);
    }

    #[test]
    fn batcher_emits_same_file_again_on_next_tick() {
        let mut batcher = PrepareProgressBatcher::new();
        batcher.push_update(PrepareFileProgressUpdate {
            file_id: "f1".to_string(),
            name: "a.txt".to_string(),
            path: "/tmp/a.txt".to_string(),
            status: PrepareFileStatusDto::Importing,
            processed_bytes: 10,
            total_bytes: 100,
            error: None,
        });

        let tick_one = batcher.flush();
        assert_eq!(tick_one.changed_file_ids, vec!["f1".to_string()]);
        assert_eq!(tick_one.files.len(), 1);
        assert_eq!(tick_one.files[0].processed_bytes, 10);

        batcher.push_update(PrepareFileProgressUpdate {
            file_id: "f1".to_string(),
            name: "a.txt".to_string(),
            path: "/tmp/a.txt".to_string(),
            status: PrepareFileStatusDto::Importing,
            processed_bytes: 90,
            total_bytes: 100,
            error: None,
        });

        let tick_two = batcher.flush();
        assert_eq!(tick_two.changed_file_ids, vec!["f1".to_string()]);
        assert_eq!(tick_two.files.len(), 1);
        assert_eq!(tick_two.files[0].processed_bytes, 90);
    }
}
