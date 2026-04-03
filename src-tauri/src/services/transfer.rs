use std::{collections::HashMap, path::Path, path::PathBuf, time::Instant};

use iroh_blobs::provider::events::{ProviderMessage, RequestUpdate};
use tauri::{Emitter, Manager};
use tokio::time::{sleep, Duration};

use crate::{
    api::dto::{
        CancelResponse, LocalFileInfo, PackageDownloadResponse, PackagePreviewResponse,
        TransferCompletedEvent, TransferErrorEvent, TransferPeerConnectedEvent,
        TransferProgressEvent,
    },
    state::{IrohAppState, SessionMeta, TransferLifecycleState},
    utils::{
        ids::next_id,
        paths::{download_staging_dir, resolve_download_dir},
    },
};

struct DownloadPreparation {
    session_id: String,
    package_id: String,
    ticket: String,
    total_bytes: u64,
    output_dir: PathBuf,
}

struct DownloadTaskInput {
    app: tauri::AppHandle,
    session_id: String,
    package_id: String,
    ticket: String,
    total_bytes: u64,
    output_dir: PathBuf,
    registry: crate::state::TransferRegistry,
}

pub async fn package_preview(
    ticket: String,
    state: &IrohAppState,
) -> Result<PackagePreviewResponse, String> {
    let node = {
        let guard = state.node.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "iroh node not initialized".to_string())?
    };
    let preview = node
        .preview_collection(&ticket)
        .await
        .map_err(|err| err.to_string())?;

    let files = preview
        .files
        .into_iter()
        .map(|file| LocalFileInfo {
            path: String::new(),
            name: file.name,
            size_bytes: file.size_bytes,
            mime_type: file.mime_type,
        })
        .collect();

    Ok(PackagePreviewResponse {
        package_id: preview.package_id,
        files,
        total_size_bytes: preview.total_size_bytes,
    })
}

pub async fn package_download(
    ticket: String,
    package_id: Option<String>,
    download_dir: Option<String>,
    app: tauri::AppHandle,
    state: &IrohAppState,
) -> Result<PackageDownloadResponse, String> {
    let prep = prepare_download_session(ticket, package_id, download_dir, &app, state).await?;

    let response = PackageDownloadResponse {
        session_id: prep.session_id.clone(),
        package_id: prep.package_id.clone(),
    };

    let task_input = DownloadTaskInput {
        app: app.clone(),
        session_id: prep.session_id.clone(),
        package_id: prep.package_id.clone(),
        ticket: prep.ticket,
        total_bytes: prep.total_bytes,
        output_dir: prep.output_dir,
        registry: state.registry.clone(),
    };

    let task = tauri::async_runtime::spawn(async move {
        let entered_transferring = task_input
            .registry
            .transition_state(&task_input.session_id, TransferLifecycleState::Transferring)
            .unwrap_or(false);
        if !entered_transferring {
            cleanup_session(&task_input.registry, &task_input.session_id);
            return;
        }

        let _ = emit_transfer_progress(
            &task_input.app,
            &task_input.session_id,
            &task_input.package_id,
            0,
            task_input.total_bytes,
            None,
        );

        let result = run_fetch_and_export(
            &task_input.app,
            &task_input.session_id,
            &task_input.package_id,
            &task_input.ticket,
            task_input.total_bytes,
            &task_input.output_dir,
        )
        .await;

        match result {
            Ok(()) => {
                let entered_finalizing = task_input
                    .registry
                    .transition_state(&task_input.session_id, TransferLifecycleState::Finalizing)
                    .unwrap_or(false);

                if entered_finalizing {
                    finalize_success(
                        &task_input.app,
                        &task_input.session_id,
                        &task_input.package_id,
                        task_input.total_bytes,
                        &task_input.output_dir,
                    );
                    let _ = task_input.registry.transition_state(
                        &task_input.session_id,
                        TransferLifecycleState::Completed,
                    );
                }
            }
            Err(message) => {
                let marked_failed = task_input
                    .registry
                    .transition_state(&task_input.session_id, TransferLifecycleState::Failed)
                    .unwrap_or(false);
                if marked_failed {
                    finalize_failure(
                        &task_input.app,
                        &task_input.session_id,
                        &task_input.package_id,
                        message,
                    );
                }
            }
        }

        cleanup_session(&task_input.registry, &task_input.session_id);
    });

    state.registry.insert_download(prep.session_id, task)?;

    Ok(response)
}

pub fn transfer_cancel(session_id: String, state: &IrohAppState) -> Result<CancelResponse, String> {
    let was_running = state.registry.cancel_session(&session_id)?;

    Ok(CancelResponse { ok: was_running })
}

pub async fn run_provider_event_bridge(
    mut rx: tokio::sync::mpsc::Receiver<ProviderMessage>,
    app: tauri::AppHandle,
    registry: crate::state::TransferRegistry,
    throttle_delay: Duration,
) {
    let mut connection_peers: HashMap<u64, String> = HashMap::new();

    macro_rules! spawn_request_updates_handler {
        ($requested_hash:expr, $connection_id:expr, $updates:expr) => {{
            let app_handle = app.clone();
            let transfer_registry = registry.clone();
            let peers = connection_peers.clone();
            let requested_hash = $requested_hash;
            let connection_id = $connection_id;
            let mut updates = $updates;
            tauri::async_runtime::spawn(async move {
                let Some((session_id, package_id, total_bytes)) =
                    resolve_transfer_context(&requested_hash, &transfer_registry)
                else {
                    return;
                };

                emit_transfer_peer_connected(
                    &app_handle,
                    &peers,
                    connection_id,
                    &session_id,
                    &package_id,
                );

                while let Ok(Some(update)) = updates.recv().await {
                    emit_progress_update(
                        &app_handle,
                        &session_id,
                        &package_id,
                        total_bytes,
                        update,
                    );
                }
            });
        }};
    }

    while let Some(msg) = rx.recv().await {
        match msg {
            ProviderMessage::ClientConnectedNotify(event) => {
                if let Some(peer) = event.inner.endpoint_id {
                    connection_peers.insert(event.inner.connection_id, peer.to_string());
                }
            }
            ProviderMessage::GetRequestReceivedNotify(event) => {
                spawn_request_updates_handler!(
                    event.inner.request.hash.to_string(),
                    event.inner.connection_id,
                    event.rx
                );
            }
            ProviderMessage::GetManyRequestReceivedNotify(event) => {
                if let Some(first_hash) = event.inner.request.hashes.first() {
                    spawn_request_updates_handler!(
                        first_hash.to_string(),
                        event.inner.connection_id,
                        event.rx
                    );
                }
            }
            ProviderMessage::Throttle(event) => {
                if !throttle_delay.is_zero() {
                    sleep(throttle_delay).await;
                }
                let _ = event.tx.send(Ok(())).await;
            }
            _ => {}
        }
    }
}

fn resolve_transfer_context(
    hash: &str,
    registry: &crate::state::TransferRegistry,
) -> Option<(String, String, u64)> {
    registry.resolve_transfer_context(hash)
}

fn emit_transfer_peer_connected(
    app: &tauri::AppHandle,
    peers: &HashMap<u64, String>,
    connection_id: u64,
    session_id: &str,
    package_id: &str,
) {
    if let Some(peer) = peers.get(&connection_id) {
        let _ = app.emit(
            "transfer:peer-connected",
            TransferPeerConnectedEvent {
                session_id: session_id.to_string(),
                package_id: package_id.to_string(),
                peer_id: peer.clone(),
            },
        );
    }
}

fn emit_progress_update(
    app: &tauri::AppHandle,
    session_id: &str,
    package_id: &str,
    total_bytes: u64,
    update: RequestUpdate,
) {
    let (transferred_bytes, completed) = match update {
        RequestUpdate::Started(_) => (0, false),
        RequestUpdate::Progress(progress) => (progress.end_offset.min(total_bytes), false),
        RequestUpdate::Completed(_) => (total_bytes, true),
        RequestUpdate::Aborted(_) => return,
    };

    let _ = emit_transfer_progress(
        app,
        session_id,
        package_id,
        transferred_bytes,
        total_bytes,
        None,
    );

    if completed {
        let _ = emit_transfer_completed(app, session_id, package_id, None);
    }
}

async fn prepare_download_session(
    ticket: String,
    package_id: Option<String>,
    download_dir: Option<String>,
    app: &tauri::AppHandle,
    state: &IrohAppState,
) -> Result<DownloadPreparation, String> {
    let package_id = package_id.unwrap_or_else(|| next_id("pkg"));
    let session_id = next_id("recv-session");

    let node = {
        let guard = state.node.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "iroh node not initialized".to_string())?
    };
    let preview = node
        .preview_collection(&ticket)
        .await
        .map_err(|err| err.to_string())?;
    let total_bytes = preview.total_size_bytes;

    state.registry.insert_session(
        session_id.clone(),
        SessionMeta {
            package_id: package_id.clone(),
            total_bytes,
        },
    )?;

    let output_dir = resolve_download_dir(app, download_dir)?.join(format!("qs-{session_id}"));
    Ok(DownloadPreparation {
        session_id,
        package_id,
        ticket,
        total_bytes,
        output_dir,
    })
}

async fn run_fetch_and_export(
    app: &tauri::AppHandle,
    session_id: &str,
    package_id: &str,
    ticket: &str,
    total_bytes: u64,
    output_dir: &Path,
) -> Result<(), String> {
    let tmp_dir = download_staging_dir(session_id);
    let result = async {
        let exported = {
            let state_guard = app
                .try_state::<IrohAppState>()
                .ok_or_else(|| "app state unavailable".to_string())?;
            let node = state_guard
                .node
                .lock()
                .await
                .as_ref()
                .cloned()
                .ok_or_else(|| "iroh node not initialized".to_string())?;
            let app_for_progress = app.clone();
            let session_for_progress = session_id.to_string();
            let package_for_progress = package_id.to_string();
            let mut last_emit_at = Instant::now();
            let mut last_emitted_bytes = 0_u64;
            let min_emit_interval = Duration::from_millis(100);
            let min_emit_delta_bytes = 256 * 1024;

            node.fetch_collection_to_dir(ticket, &tmp_dir, |bytes| {
                let clamped_bytes = bytes.min(total_bytes);
                let now = Instant::now();
                let should_emit = clamped_bytes >= total_bytes
                    || clamped_bytes.saturating_sub(last_emitted_bytes) >= min_emit_delta_bytes
                    || now.duration_since(last_emit_at) >= min_emit_interval;
                if !should_emit {
                    return;
                }
                last_emit_at = now;
                last_emitted_bytes = clamped_bytes;

                let _ = emit_transfer_progress(
                    &app_for_progress,
                    &session_for_progress,
                    &package_for_progress,
                    clamped_bytes,
                    total_bytes,
                    None,
                );
            })
            .await
            .map_err(|err| err.to_string())?
        };

        let mut transferred = 0_u64;
        for path in &exported {
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string();

            let size = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
            transferred = transferred.saturating_add(size).min(total_bytes);

            let _ = emit_transfer_progress(
                app,
                session_id,
                package_id,
                transferred,
                total_bytes,
                Some(file_name),
            );
        }

        std::fs::create_dir_all(output_dir).map_err(|err| {
            format!(
                "failed to create output dir {}: {err}",
                output_dir.display()
            )
        })?;

        for src in exported {
            let relative = src
                .strip_prefix(&tmp_dir)
                .map_err(|_| format!("failed to compute relative path for {}", src.display()))?;
            let target = output_dir.join(relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|err| {
                    format!("failed to create output dir {}: {err}", parent.display())
                })?;
            }
            std::fs::rename(&src, &target).map_err(|err| {
                format!(
                    "failed to move {} to {}: {err}",
                    src.display(),
                    target.display()
                )
            })?;
        }

        Ok::<(), String>(())
    }
    .await;

    let _ = std::fs::remove_dir_all(&tmp_dir);
    result
}

fn finalize_success(
    app: &tauri::AppHandle,
    session_id: &str,
    package_id: &str,
    total_bytes: u64,
    output_dir: &Path,
) {
    let _ = emit_transfer_progress(app, session_id, package_id, total_bytes, total_bytes, None);
    let _ = emit_transfer_completed(
        app,
        session_id,
        package_id,
        Some(output_dir.display().to_string()),
    );
}

fn finalize_failure(app: &tauri::AppHandle, session_id: &str, package_id: &str, message: String) {
    let _ = emit_transfer_error(
        app,
        session_id,
        Some(package_id.to_string()),
        "download_failed",
        message,
    );
}

fn cleanup_session(registry: &crate::state::TransferRegistry, session_id: &str) {
    registry.cleanup_session(session_id);
}

fn emit_transfer_progress(
    app: &tauri::AppHandle,
    session_id: &str,
    package_id: &str,
    transferred_bytes: u64,
    total_bytes: u64,
    file_name: Option<String>,
) -> Result<(), String> {
    app.emit(
        "transfer:progress",
        TransferProgressEvent {
            session_id: session_id.to_string(),
            package_id: package_id.to_string(),
            transferred_bytes,
            total_bytes,
            file_name,
        },
    )
    .map_err(|err| format!("failed to emit transfer:progress event: {err}"))
}

fn emit_transfer_completed(
    app: &tauri::AppHandle,
    session_id: &str,
    package_id: &str,
    download_dir: Option<String>,
) -> Result<(), String> {
    app.emit(
        "transfer:completed",
        TransferCompletedEvent {
            session_id: session_id.to_string(),
            package_id: package_id.to_string(),
            download_dir,
        },
    )
    .map_err(|err| format!("failed to emit transfer:completed event: {err}"))
}

fn emit_transfer_error(
    app: &tauri::AppHandle,
    session_id: &str,
    package_id: Option<String>,
    code: &str,
    message: String,
) -> Result<(), String> {
    app.emit(
        "transfer:error",
        TransferErrorEvent {
            session_id: session_id.to_string(),
            package_id,
            code: code.to_string(),
            message,
        },
    )
    .map_err(|err| format!("failed to emit transfer:error event: {err}"))
}

pub fn configured_throttle_delay() -> Duration {
    let ms = std::env::var("QUICKSEND_THROTTLE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    Duration::from_millis(ms)
}

pub fn cleanup_iroh_node_dir(path: &Path) {
    if let Err(err) = std::fs::remove_dir_all(path) {
        if err.kind() == std::io::ErrorKind::NotFound {
            return;
        }
        eprintln!("failed to remove iroh node dir {}: {err}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{PrepareRegistry, TransferRegistry};
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    fn make_registry() -> TransferRegistry {
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let hash_to_session = Arc::new(Mutex::new(HashMap::new()));
        let downloads = Arc::new(Mutex::new(HashMap::new()));
        TransferRegistry::new(sessions, hash_to_session, downloads)
    }

    fn make_prepare_registry() -> PrepareRegistry {
        PrepareRegistry::new(Arc::new(Mutex::new(HashMap::new())))
    }

    #[tokio::test]
    async fn transfer_cancel_only_cancels_target_session() {
        let registry = make_registry();

        for (session_id, package_id) in [("sb", "pb"), ("sc", "pc")] {
            registry
                .insert_session(
                    session_id.to_string(),
                    SessionMeta {
                        package_id: package_id.to_string(),
                        total_bytes: 100,
                    },
                )
                .expect("insert session");
            registry
                .insert_download(
                    session_id.to_string(),
                    tauri::async_runtime::spawn(async {
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }),
                )
                .expect("insert download");
        }

        let state = IrohAppState {
            node: tokio::sync::Mutex::new(None),
            registry: registry.clone(),
            prepare_registry: make_prepare_registry(),
            node_dir: std::env::temp_dir().join("quicksend-transfer-cancel-test"),
        };

        let cancel_result = transfer_cancel("sb".to_string(), &state).expect("cancel response");
        assert!(cancel_result.ok);
        assert!(registry.get_session("sb").is_none());
        assert!(registry.remove_download("sb").is_none());

        assert!(registry.get_session("sc").is_some());
        assert!(registry.remove_download("sc").is_some());
    }

    async fn run_cancel_vs_terminal_race(target_terminal: TransferLifecycleState) {
        let registry = make_registry();
        registry
            .insert_session(
                "srace".to_string(),
                SessionMeta {
                    package_id: "prace".to_string(),
                    total_bytes: 100,
                },
            )
            .expect("insert session");
        registry
            .map_hash_to_session("hrace".to_string(), "srace".to_string())
            .expect("map hash");
        assert!(registry
            .transition_state("srace", TransferLifecycleState::Transferring)
            .expect("transition to transferring"));
        registry
            .insert_download(
                "srace".to_string(),
                tauri::async_runtime::spawn(async {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }),
            )
            .expect("insert download");

        let state = IrohAppState {
            node: tokio::sync::Mutex::new(None),
            registry: registry.clone(),
            prepare_registry: make_prepare_registry(),
            node_dir: std::env::temp_dir().join("quicksend-transfer-race-test"),
        };

        let cancel_fut = async {
            tokio::task::yield_now().await;
            transfer_cancel("srace".to_string(), &state)
        };
        let terminal_fut = async {
            tokio::task::yield_now().await;
            let _ = registry.transition_state("srace", target_terminal);
            cleanup_session(&registry, "srace");
        };

        let (cancel_result, _) = tokio::join!(cancel_fut, terminal_fut);
        assert!(cancel_result.is_ok());

        assert!(registry.get_session("srace").is_none());
        assert!(registry.lookup_session_by_hash("hrace").is_none());
        assert!(registry.remove_download("srace").is_none());
        assert!(registry.get_lifecycle_state("srace").is_none());
    }

    #[tokio::test]
    async fn cancel_racing_with_failed_terminal_path_is_deterministic() {
        run_cancel_vs_terminal_race(TransferLifecycleState::Failed).await;
    }

    #[tokio::test]
    async fn cancel_racing_with_finalizing_terminal_path_is_deterministic() {
        run_cancel_vs_terminal_race(TransferLifecycleState::Finalizing).await;
    }
}
