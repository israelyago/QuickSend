use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use tauri::{AppHandle, Emitter};

use crate::{
    api::dto::{
        CancelResponse, PackagePrepareAddFilesResponse, PackagePrepareFinalizeResponse,
        PackagePrepareStartResponse, PrepareFileProgress, PrepareFileStatusDto,
        PrepareProgressSummary, PrepareSessionStatusDto, SendPrepareProgressEvent,
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
        .map(|(idx, file)| build_initial_file_state(format!("f{idx}"), file))
        .collect::<Vec<_>>();

    state.prepare_registry.insert_session(
        prepare_session_id.clone(),
        PrepareSessionMeta::with_files(package_id.clone(), file_states),
    )?;

    ensure_prepare_worker_for_files(
        app,
        state,
        prepare_session_id.clone(),
        package_id.clone(),
        source_files
            .into_iter()
            .enumerate()
            .map(|(idx, file)| (format!("f{idx}"), file))
            .collect(),
    )
    .await?;

    Ok(PackagePrepareStartResponse {
        prepare_session_id,
        package_id,
    })
}

pub async fn package_prepare_add_files(
    prepare_session_id: String,
    files: Vec<String>,
    roots: Option<Vec<String>>,
    app: AppHandle,
    state: &IrohAppState,
) -> Result<PackagePrepareAddFilesResponse, String> {
    let source_files = build_source_files(files, roots)?;
    if source_files.is_empty() {
        return Err("at least one file is required".to_string());
    }

    let session = state
        .prepare_registry
        .get_session(&prepare_session_id)
        .ok_or_else(|| format!("prepare session not found: {prepare_session_id}"))?;
    let package_id = session.package_id.clone();

    let mut accepted: Vec<(String, SourceFile)> = Vec::new();
    let _ = state
        .prepare_registry
        .update_session(&prepare_session_id, |session| {
            for file in source_files {
                let path = file.path.display().to_string();
                let already_known = session.files.iter().any(|existing| {
                    existing.path == path && existing.status != PrepareFileLifecycleState::Cancelled
                });
                if already_known {
                    continue;
                }

                let file_id = format!("f{}", session.next_file_seq);
                session.next_file_seq = session.next_file_seq.saturating_add(1);
                session
                    .files
                    .push(build_initial_file_state(file_id.clone(), &file));
                accepted.push((file_id, file));
            }
        })?;

    if accepted.is_empty() {
        return Ok(PackagePrepareAddFilesResponse {
            ok: true,
            prepare_session_id,
            package_id,
        });
    }

    let _ = state
        .prepare_registry
        .transition_state(&prepare_session_id, PrepareLifecycleState::Running);

    ensure_prepare_worker_for_files(
        app,
        state,
        prepare_session_id.clone(),
        package_id.clone(),
        accepted,
    )
    .await?;

    Ok(PackagePrepareAddFilesResponse {
        ok: true,
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
    if state.prepare_registry.has_task(&prepare_session_id) {
        return Err(format!(
            "prepare session {prepare_session_id} is still importing files"
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
    file_id: Option<String>,
    file_path: Option<String>,
    state: &IrohAppState,
) -> Result<CancelResponse, String> {
    let resolved_file_id = if let Some(file_id) = file_id {
        Some(file_id)
    } else if let Some(file_path) = file_path {
        state
            .prepare_registry
            .get_session(&prepare_session_id)
            .and_then(|session| {
                session
                    .files
                    .into_iter()
                    .find(|file| file.path == file_path)
                    .map(|file| file.file_id)
            })
    } else {
        None
    };

    let Some(file_id) = resolved_file_id else {
        return Ok(CancelResponse { ok: false });
    };

    let ok = state
        .prepare_registry
        .request_remove_file(&prepare_session_id, &file_id)?;
    if ok {
        let _ = state
            .prepare_registry
            .update_session(&prepare_session_id, |session| {
                if let Some(file) = session
                    .files
                    .iter_mut()
                    .find(|file| file.file_id == file_id)
                {
                    if let Some(hash) = file.hash.take() {
                        session
                            .imported_hashes
                            .retain(|(name, value)| !(name == &file.name && value == &hash));
                    }
                    file.status = PrepareFileLifecycleState::Cancelled;
                    file.error = None;
                }
            });
    }
    Ok(CancelResponse { ok })
}

pub fn package_prepare_status(
    prepare_session_id: String,
    state: &IrohAppState,
) -> Result<SendPrepareProgressEvent, String> {
    build_prepare_snapshot(&state.prepare_registry, &prepare_session_id)
}

async fn ensure_prepare_worker_for_files(
    app: AppHandle,
    state: &IrohAppState,
    prepare_session_id: String,
    package_id: String,
    files: Vec<(String, SourceFile)>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let node = {
        let guard = state.node.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "iroh node not initialized".to_string())?
    };

    let registry = state.prepare_registry.clone();
    let app_handle = app.clone();
    let worker_session_id = prepare_session_id.clone();
    let worker_package_id = package_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        run_prepare_worker(
            app_handle,
            registry,
            node,
            worker_session_id,
            worker_package_id,
            files,
        )
        .await;
    });
    state
        .prepare_registry
        .register_task(prepare_session_id, task)?;
    Ok(())
}

async fn run_prepare_worker(
    app: AppHandle,
    registry: crate::state::PrepareRegistry,
    node: std::sync::Arc<crate::iroh::IrohNode>,
    prepare_session_id: String,
    package_id: String,
    source_files: Vec<(String, SourceFile)>,
) {
    let (progress_tx, mut progress_rx) =
        tokio::sync::mpsc::unbounded_channel::<PrepareFileProgressUpdate>();

    let _ = registry.transition_state(&prepare_session_id, PrepareLifecycleState::Running);

    let importer_registry = registry.clone();
    let importer_session_id = prepare_session_id.clone();
    let mut importer = tauri::async_runtime::spawn(async move {
        for (file_id, file) in source_files {
            if importer_registry.is_cancel_requested(&importer_session_id)
                || importer_registry
                    .take_remove_file_request(&importer_session_id, &file_id)
                    .unwrap_or(false)
            {
                let _ = importer_registry.update_session(&importer_session_id, |session| {
                    if let Some(item) = session
                        .files
                        .iter_mut()
                        .find(|entry| entry.file_id == file_id)
                    {
                        item.status = PrepareFileLifecycleState::Cancelled;
                        item.error = None;
                    }
                });
                if let Some(snapshot) = importer_registry.get_session(&importer_session_id) {
                    if let Some(item) = snapshot
                        .files
                        .into_iter()
                        .find(|entry| entry.file_id == file_id)
                    {
                        let _ = progress_tx.send(file_state_to_progress_update(item));
                    }
                }
                continue;
            }

            let _ = importer_registry.update_session(&importer_session_id, |session| {
                if let Some(item) = session
                    .files
                    .iter_mut()
                    .find(|entry| entry.file_id == file_id)
                {
                    item.status = PrepareFileLifecycleState::Importing;
                    item.error = None;
                }
            });
            if let Some(snapshot) = importer_registry.get_session(&importer_session_id) {
                if let Some(item) = snapshot
                    .files
                    .into_iter()
                    .find(|entry| entry.file_id == file_id)
                {
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
                        if let Some(item) = session
                            .files
                            .iter_mut()
                            .find(|entry| entry.file_id == progress_file_id)
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
                            if let Some(item) = session
                                .files
                                .iter_mut()
                                .find(|entry| entry.file_id == file_id)
                            {
                                item.status = PrepareFileLifecycleState::Cancelled;
                                item.error = None;
                                item.hash = None;
                            }
                        });
                    } else {
                        let _ = importer_registry.update_session(&importer_session_id, |session| {
                            if let Some(item) = session
                                .files
                                .iter_mut()
                                .find(|entry| entry.file_id == file_id)
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
                        if let Some(item) = session
                            .files
                            .iter_mut()
                            .find(|entry| entry.file_id == file_id)
                        {
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
                if let Some(item) = snapshot
                    .files
                    .into_iter()
                    .find(|entry| entry.file_id == file_id)
                {
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

    registry.retire_task(&prepare_session_id);
    let session = registry.get_session(&prepare_session_id);
    let Some(session) = session else {
        return;
    };

    let completed_files = session
        .files
        .iter()
        .filter(|file| file.status == PrepareFileLifecycleState::Completed)
        .count();

    let all_terminal = session.files.iter().all(|file| {
        matches!(
            file.status,
            PrepareFileLifecycleState::Completed
                | PrepareFileLifecycleState::Failed
                | PrepareFileLifecycleState::Cancelled
        )
    });
    if !all_terminal {
        if batcher.has_pending() {
            let batch = batcher.flush();
            let _ = emit_prepare_progress_event(
                &app,
                &registry,
                &prepare_session_id,
                &package_id,
                batch,
                false,
            );
        }
        return;
    }

    let terminal = if registry.is_cancel_requested(&prepare_session_id) {
        PrepareLifecycleState::Cancelled
    } else if completed_files > 0 {
        PrepareLifecycleState::Completed
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

fn build_initial_file_state(file_id: String, file: &SourceFile) -> PrepareFileState {
    let total_bytes = std::fs::metadata(&file.path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    PrepareFileState {
        file_id,
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
    let total_bytes = session
        .files
        .iter()
        .map(|file| file.total_bytes)
        .sum::<u64>();

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

fn build_prepare_snapshot(
    registry: &crate::state::PrepareRegistry,
    prepare_session_id: &str,
) -> Result<SendPrepareProgressEvent, String> {
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
    let total_bytes = session
        .files
        .iter()
        .map(|file| file.total_bytes)
        .sum::<u64>();
    let files = session
        .files
        .iter()
        .cloned()
        .map(file_state_to_progress)
        .collect::<Vec<_>>();
    let changed_file_ids = session
        .files
        .iter()
        .map(|file| file.file_id.clone())
        .collect::<Vec<_>>();
    let done = matches!(
        status,
        PrepareLifecycleState::Completed
            | PrepareLifecycleState::Failed
            | PrepareLifecycleState::Cancelled
    );

    Ok(SendPrepareProgressEvent {
        prepare_session_id: prepare_session_id.to_string(),
        package_id: session.package_id,
        status: lifecycle_to_dto(status),
        summary: PrepareProgressSummary {
            total_files,
            completed_files,
            failed_files,
            cancelled_files,
            processed_bytes,
            total_bytes,
        },
        files,
        sequence: session.emit_sequence,
        done,
        changed_file_ids,
    })
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
        assert_eq!(
            flushed.changed_file_ids,
            vec!["f1".to_string(), "f2".to_string()]
        );
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

    // ── package_prepare_add_files: incremental behavior ───────────────────

    fn make_prepare_registry() -> crate::state::PrepareRegistry {
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex};
        crate::state::PrepareRegistry::new(Arc::new(Mutex::new(HashMap::new())))
    }

    fn make_session_with_files(
        pkg_id: &str,
        file_names: &[(&str, &str)],
    ) -> crate::state::PrepareSessionMeta {
        // file_names: slice of (name, path) pairs
        let files: Vec<PrepareFileState> = file_names
            .iter()
            .enumerate()
            .map(|(idx, (name, path))| PrepareFileState {
                file_id: format!("f{idx}"),
                name: name.to_string(),
                path: path.to_string(),
                status: PrepareFileLifecycleState::Queued,
                processed_bytes: 0,
                total_bytes: 1024,
                error: None,
                hash: None,
            })
            .collect();
        crate::state::PrepareSessionMeta::with_files(pkg_id.to_string(), files)
    }

    /// Adding a new path to an active session appends the file and advances
    /// `next_file_seq`.
    #[test]
    fn add_files_to_session_appends_new_files_and_advances_seq() {
        let registry = make_prepare_registry();
        let session =
            make_session_with_files("pkg-1", &[("a.txt", "/tmp/a.txt"), ("b.txt", "/tmp/b.txt")]);
        registry
            .insert_session("prep-1".to_string(), session)
            .expect("insert session");

        let new_name = "c.txt";
        let new_path = "/tmp/c.txt";

        let _ = registry.update_session("prep-1", |session| {
            let already_known = session.files.iter().any(|existing| {
                existing.path == new_path && existing.status != PrepareFileLifecycleState::Cancelled
            });
            assert!(!already_known, "path should not be known yet");

            let file_id = format!("f{}", session.next_file_seq);
            session.next_file_seq = session.next_file_seq.saturating_add(1);
            session.files.push(build_initial_file_state(
                file_id,
                &crate::iroh::SourceFile {
                    path: std::path::PathBuf::from(new_path),
                    name: new_name.to_string(),
                },
            ));
        });

        let snap = registry.get_session("prep-1").expect("session exists");
        assert_eq!(snap.files.len(), 3, "file count should grow to 3");
        assert_eq!(snap.next_file_seq, 3);
        assert_eq!(snap.files[2].name, "c.txt");
        assert_eq!(snap.files[2].file_id, "f2");
    }

    /// Adding the same path a second time (while not cancelled) must be a no-op.
    #[test]
    fn add_files_skips_duplicate_active_path() {
        let registry = make_prepare_registry();
        let session = make_session_with_files("pkg-2", &[("a.txt", "/tmp/a.txt")]);
        registry
            .insert_session("prep-2".to_string(), session)
            .expect("insert session");

        let dup_path = "/tmp/a.txt";
        let mut accepted = false;
        let _ = registry.update_session("prep-2", |session| {
            let already_known = session.files.iter().any(|existing| {
                existing.path == dup_path && existing.status != PrepareFileLifecycleState::Cancelled
            });
            if already_known {
                return;
            }
            let file_id = format!("f{}", session.next_file_seq);
            session.next_file_seq = session.next_file_seq.saturating_add(1);
            session.files.push(build_initial_file_state(
                file_id,
                &crate::iroh::SourceFile {
                    path: std::path::PathBuf::from(dup_path),
                    name: "a.txt".to_string(),
                },
            ));
            accepted = true;
        });

        assert!(!accepted, "duplicate path should be rejected");
        let snap = registry.get_session("prep-2").expect("session exists");
        assert_eq!(snap.files.len(), 1, "file list must not grow");
    }

    /// A cancelled path is eligible to be re-added.
    #[test]
    fn add_files_allows_re_adding_cancelled_path() {
        let registry = make_prepare_registry();
        let mut session = make_session_with_files("pkg-3", &[("a.txt", "/tmp/a.txt")]);
        session.files[0].status = PrepareFileLifecycleState::Cancelled;
        registry
            .insert_session("prep-3".to_string(), session)
            .expect("insert session");

        let path = "/tmp/a.txt";
        let mut accepted = false;
        let _ = registry.update_session("prep-3", |session| {
            let already_known = session.files.iter().any(|existing| {
                existing.path == path && existing.status != PrepareFileLifecycleState::Cancelled
            });
            if already_known {
                return;
            }
            let file_id = format!("f{}", session.next_file_seq);
            session.next_file_seq = session.next_file_seq.saturating_add(1);
            session.files.push(build_initial_file_state(
                file_id,
                &crate::iroh::SourceFile {
                    path: std::path::PathBuf::from(path),
                    name: "a.txt".to_string(),
                },
            ));
            accepted = true;
        });

        assert!(accepted, "cancelled path should be re-accepted");
        let snap = registry.get_session("prep-3").expect("session exists");
        assert_eq!(snap.files.len(), 2);
    }

    // ── Remove-while-preparing edge cases ─────────────────────────────────

    /// A remove request that arrives before the worker touches the file must be
    /// recorded and consumable exactly once.
    #[test]
    fn remove_request_is_registered_and_takeable_once() {
        let registry = make_prepare_registry();
        let session = make_session_with_files("pkg-4", &[("x.txt", "/tmp/x.txt")]);
        registry
            .insert_session("prep-r1".to_string(), session)
            .expect("insert session");

        let ok = registry
            .request_remove_file("prep-r1", "f0")
            .expect("request remove");
        assert!(ok, "remove should be accepted for a known session");

        let taken = registry
            .take_remove_file_request("prep-r1", "f0")
            .expect("take");
        assert!(taken, "request should be present once");

        let taken_again = registry
            .take_remove_file_request("prep-r1", "f0")
            .expect("take again");
        assert!(!taken_again, "request must be consumed exactly once");
    }

    /// When a completed file is removed, its hash must be pruned from
    /// `imported_hashes` so it is excluded from the finalize ticket.
    #[test]
    fn remove_file_prunes_hash_from_imported_hashes() {
        let registry = make_prepare_registry();
        let mut session =
            make_session_with_files("pkg-5", &[("a.txt", "/tmp/a.txt"), ("b.txt", "/tmp/b.txt")]);

        let fake_hash_a = "aaaa".to_string();
        let fake_hash_b = "bbbb".to_string();
        session.files[0].hash = Some(fake_hash_a.clone());
        session.files[0].status = PrepareFileLifecycleState::Completed;
        session.files[1].hash = Some(fake_hash_b.clone());
        session.files[1].status = PrepareFileLifecycleState::Completed;
        session.imported_hashes = vec![
            ("a.txt".to_string(), fake_hash_a),
            ("b.txt".to_string(), fake_hash_b),
        ];
        registry
            .insert_session("prep-r2".to_string(), session)
            .expect("insert session");

        // Simulate the cleanup done by package_prepare_remove_file.
        let file_id_to_remove = "f0";
        let _ = registry.update_session("prep-r2", |session| {
            if let Some(file) = session
                .files
                .iter_mut()
                .find(|f| f.file_id == file_id_to_remove)
            {
                if let Some(hash) = file.hash.take() {
                    session
                        .imported_hashes
                        .retain(|(name, value)| !(name == &file.name && value == &hash));
                }
                file.status = PrepareFileLifecycleState::Cancelled;
                file.error = None;
            }
        });

        let snap = registry.get_session("prep-r2").expect("session exists");
        assert_eq!(snap.imported_hashes.len(), 1);
        assert_eq!(snap.imported_hashes[0].0, "b.txt");
        assert_eq!(
            snap.files
                .iter()
                .find(|f| f.file_id == "f0")
                .unwrap()
                .status,
            PrepareFileLifecycleState::Cancelled
        );
    }

    /// Removing a file that never completed (no hash) must not alter
    /// `imported_hashes`.
    #[test]
    fn remove_file_without_hash_leaves_imported_hashes_intact() {
        let registry = make_prepare_registry();
        let mut session =
            make_session_with_files("pkg-6", &[("a.txt", "/tmp/a.txt"), ("b.txt", "/tmp/b.txt")]);
        // Only b.txt finished – a.txt is still queued (no hash).
        session.files[1].hash = Some("bbbb".to_string());
        session.files[1].status = PrepareFileLifecycleState::Completed;
        session.imported_hashes = vec![("b.txt".to_string(), "bbbb".to_string())];
        registry
            .insert_session("prep-r3".to_string(), session)
            .expect("insert session");

        let _ = registry.update_session("prep-r3", |session| {
            if let Some(file) = session.files.iter_mut().find(|f| f.file_id == "f0") {
                if let Some(hash) = file.hash.take() {
                    session
                        .imported_hashes
                        .retain(|(name, value)| !(name == &file.name && value == &hash));
                }
                file.status = PrepareFileLifecycleState::Cancelled;
            }
        });

        let snap = registry.get_session("prep-r3").expect("session");
        assert_eq!(snap.imported_hashes.len(), 1);
        assert_eq!(snap.imported_hashes[0].0, "b.txt");
    }

    // ── Finalize gating while prepare is still running ────────────────────

    /// `has_task` must return `true` while a worker task is registered,
    /// causing finalize to return an error.
    #[tokio::test]
    async fn finalize_blocked_while_task_is_registered() {
        let registry = make_prepare_registry();
        let session = make_session_with_files("pkg-7", &[("a.txt", "/tmp/a.txt")]);
        registry
            .insert_session("prep-f1".to_string(), session)
            .expect("insert session");

        let task = tauri::async_runtime::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        registry
            .register_task("prep-f1".to_string(), task)
            .expect("register task");

        assert!(
            registry.has_task("prep-f1"),
            "finalize must be blocked while task is registered"
        );
    }

    /// After `retire_task` the gating check must clear.
    #[tokio::test]
    async fn finalize_allowed_after_task_retired() {
        let registry = make_prepare_registry();
        let session = make_session_with_files("pkg-8", &[("a.txt", "/tmp/a.txt")]);
        registry
            .insert_session("prep-f2".to_string(), session)
            .expect("insert session");

        let task = tauri::async_runtime::spawn(async {});
        registry
            .register_task("prep-f2".to_string(), task)
            .expect("register task");

        assert!(registry.has_task("prep-f2"), "task should be present");
        registry.retire_task("prep-f2");
        assert!(
            !registry.has_task("prep-f2"),
            "finalize should be allowed after task is retired"
        );
    }

    /// Multiple tasks (one per `package_prepare_add_files` call) all need to
    /// be retired before finalize is unblocked.
    #[tokio::test]
    async fn finalize_blocked_until_all_tasks_retired() {
        let registry = make_prepare_registry();
        let session =
            make_session_with_files("pkg-9", &[("a.txt", "/tmp/a.txt"), ("b.txt", "/tmp/b.txt")]);
        registry
            .insert_session("prep-f3".to_string(), session)
            .expect("insert session");

        for _ in 0..2 {
            let task = tauri::async_runtime::spawn(async {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            });
            registry
                .register_task("prep-f3".to_string(), task)
                .expect("register task");
        }

        assert!(
            registry.has_task("prep-f3"),
            "still blocked after 0 retires"
        );
        registry.retire_task("prep-f3");
        assert!(registry.has_task("prep-f3"), "still blocked after 1 retire");
        registry.retire_task("prep-f3");
        assert!(
            !registry.has_task("prep-f3"),
            "unblocked after all tasks retired"
        );
    }
}
