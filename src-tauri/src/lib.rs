pub mod iroh;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::time::{sleep, Duration};

use iroh_blobs::provider::events::{ProviderMessage, RequestUpdate};
use tauri::{Emitter, Manager, RunEvent, State, Wry};

use crate::iroh::{IrohNode, SourceFile};
use tauri_plugin_clipboard_manager::Clipboard;
use tauri_plugin_opener::OpenerExt;

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

struct SessionMeta {
    package_id: String,
    total_bytes: u64,
}

struct IrohAppState {
    node: tokio::sync::Mutex<Option<Arc<IrohNode>>>,
    sessions: Arc<Mutex<HashMap<String, SessionMeta>>>,
    hash_to_session: Arc<Mutex<HashMap<String, String>>>,
    downloads: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    node_dir: PathBuf,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileInfo {
    path: String,
    name: String,
    size_bytes: u64,
    mime_type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PackageCreateResponse {
    session_id: String,
    package_id: String,
    ticket: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PackagePreviewResponse {
    package_id: String,
    files: Vec<LocalFileInfo>,
    total_size_bytes: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PackageDownloadResponse {
    session_id: String,
    package_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelResponse {
    ok: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferPeerConnectedEvent {
    session_id: String,
    package_id: String,
    peer_id: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferProgressEvent {
    session_id: String,
    package_id: String,
    transferred_bytes: u64,
    total_bytes: u64,
    file_name: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferCompletedEvent {
    session_id: String,
    package_id: String,
    download_dir: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferErrorEvent {
    session_id: String,
    package_id: Option<String>,
    code: String,
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    download_dir: String,
    theme: String,
    auto_download_max_bytes: i64,
    auto_install_updates: bool,
    size_unit: String,
}

#[tauri::command]
async fn ping() -> &'static str {
    tokio::task::yield_now().await;
    "pong"
}

#[tauri::command]
fn inspect_files(files: Vec<String>) -> Result<Vec<LocalFileInfo>, String> {
    let expanded = expand_input_paths(files)?;
    expanded
        .into_iter()
        .map(|path| {
            let metadata = std::fs::metadata(&path)
                .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;

            if !metadata.is_file() {
                return Err(format!("path is not a file: {}", path.display()));
            }

            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| format!("invalid UTF-8 file name: {}", path.display()))?
                .to_owned();

            Ok(LocalFileInfo {
                path: path.display().to_string(),
                name,
                size_bytes: metadata.len(),
                mime_type: infer_mime_type(&path),
            })
        })
        .collect()
}

fn expand_input_paths(raw_paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();

    for raw in raw_paths {
        let path = std::fs::canonicalize(&raw)
            .map_err(|err| format!("failed to canonicalize {raw}: {err}"))?;
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            collect_dir_files(&path, &mut files)?;
        } else if metadata.is_file() {
            files.push(path);
        } else {
            return Err(format!(
                "path is not a file or directory: {}",
                path.display()
            ));
        }
    }

    if files.is_empty() {
        return Err("no files found in selection".to_string());
    }

    Ok(files)
}

fn collect_dir_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|err| format!("failed to read dir {}: {err}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("failed to read dir entry: {err}"))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            collect_dir_files(&path, files)?;
        } else if metadata.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

#[tauri::command]
async fn package_create(
    files: Vec<String>,
    roots: Option<Vec<String>>,
    app: tauri::AppHandle,
    state: State<'_, IrohAppState>,
) -> Result<PackageCreateResponse, String> {
    let source_files = build_source_files(files, roots)?;
    let file_paths = source_files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<PathBuf>>();
    let total_bytes = sum_file_sizes(&file_paths)?;

    let session_id = next_id("send-session");
    let package_id = next_id("pkg");

    let node = {
        let guard = state.node.lock().await;
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| "iroh node not initialized".to_string())?
    };
    let created = node
        .create_collection_ticket(&source_files)
        .await
        .map_err(|err| err.to_string())?;

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "sessions lock poisoned".to_string())?;
        sessions.insert(
            session_id.clone(),
            SessionMeta {
                package_id: package_id.clone(),
                total_bytes,
            },
        );
    }

    {
        let mut hash_map = state
            .hash_to_session
            .lock()
            .map_err(|_| "hash map lock poisoned".to_string())?;
        for hash in created.served_hashes {
            hash_map.insert(hash, session_id.clone());
        }
    }

    let init_progress = TransferProgressEvent {
        session_id: session_id.clone(),
        package_id: package_id.clone(),
        transferred_bytes: 0,
        total_bytes,
        file_name: None,
    };

    app.emit("transfer:progress", init_progress)
        .map_err(|err| format!("failed to emit transfer:progress event: {err}"))?;

    Ok(PackageCreateResponse {
        session_id,
        package_id,
        ticket: created.ticket,
    })
}

#[tauri::command]
async fn package_preview(
    ticket: String,
    state: State<'_, IrohAppState>,
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

#[tauri::command]
fn resolve_logs_target(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(log_file) = std::env::var("QUICKSEND_LOG_FILE") {
        let path = PathBuf::from(log_file);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create logs dir {}: {err}", parent.display()))?;
        }
        return Ok(path);
    }

    if let Ok(log_dir) = std::env::var("QUICKSEND_LOG_DIR") {
        let path = PathBuf::from(log_dir);
        std::fs::create_dir_all(&path)
            .map_err(|err| format!("failed to create logs dir {}: {err}", path.display()))?;
        return Ok(path);
    }

    let path = app
        .path()
        .app_log_dir()
        .map_err(|err| format!("failed to resolve logs dir: {err}"))?;
    std::fs::create_dir_all(&path)
        .map_err(|err| format!("failed to create logs dir {}: {err}", path.display()))?;
    Ok(path)
}

#[tauri::command]
fn logs_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = resolve_logs_target(&app)?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn open_logs_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = resolve_logs_target(&app)?;
    let opened_path = path.display().to_string();
    if path.is_file() {
        app.opener()
            .reveal_item_in_dir(&path)
            .map_err(|err| format!("failed to reveal logs file {}: {err}", opened_path))?;
    } else {
        app.opener()
            .open_path(opened_path.clone(), None::<String>)
            .map_err(|err| format!("failed to open logs dir {}: {err}", opened_path))?;
    }
    Ok(opened_path)
}

#[tauri::command]
fn settings_load(app: tauri::AppHandle) -> Result<Option<PersistedSettings>, String> {
    let file = settings_file_path(&app)?;
    if !file.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&file)
        .map_err(|err| format!("failed to read settings file {}: {err}", file.display()))?;
    let parsed = serde_json::from_str::<PersistedSettings>(&content)
        .map_err(|err| format!("failed to parse settings file {}: {err}", file.display()))?;
    Ok(Some(parsed))
}

#[tauri::command]
fn settings_save(app: tauri::AppHandle, settings: PersistedSettings) -> Result<(), String> {
    let file = settings_file_path(&app)?;
    let parent = file
        .parent()
        .ok_or_else(|| format!("invalid settings path {}", file.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create settings dir {}: {err}", parent.display()))?;
    let encoded = serde_json::to_vec_pretty(&settings)
        .map_err(|err| format!("failed to encode settings: {err}"))?;
    std::fs::write(&file, encoded)
        .map_err(|err| format!("failed to write settings file {}: {err}", file.display()))?;
    Ok(())
}

#[tauri::command]
fn clipboard_ticket(clipboard: State<'_, Clipboard<Wry>>) -> Result<Option<String>, String> {
    let text = clipboard.read_text().map_err(|err| err.to_string())?;
    let trimmed = text.trim();
    if trimmed.starts_with("blob") {
        Ok(Some(trimmed.to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn package_download(
    ticket: String,
    package_id: Option<String>,
    download_dir: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, IrohAppState>,
) -> Result<PackageDownloadResponse, String> {
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
    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "sessions lock poisoned".to_string())?;
        sessions.insert(
            session_id.clone(),
            SessionMeta {
                package_id: package_id.clone(),
                total_bytes,
            },
        );
    }

    let output_dir = resolve_download_dir(download_dir)?;

    let app_handle = app.clone();
    let session_for_task = session_id.clone();
    let package_for_task = package_id.clone();
    let ticket_for_task = ticket.clone();
    let sessions_map = state.sessions.clone();
    let downloads_map = state.downloads.clone();

    let task = tauri::async_runtime::spawn(async move {
        let _ = app_handle.emit(
            "transfer:progress",
            TransferProgressEvent {
                session_id: session_for_task.clone(),
                package_id: package_for_task.clone(),
                transferred_bytes: 0,
                total_bytes,
                file_name: None,
            },
        );

        let tmp_dir = download_staging_dir(&session_for_task);
        let result = async {
            let exported = {
                let state_guard = app_handle
                    .try_state::<IrohAppState>()
                    .ok_or_else(|| "app state unavailable".to_string())?;
                let node = state_guard
                    .node
                    .lock()
                    .await
                    .as_ref()
                    .cloned()
                    .ok_or_else(|| "iroh node not initialized".to_string())?;
                let app_for_progress = app_handle.clone();
                let session_for_progress = session_for_task.clone();
                let package_for_progress = package_for_task.clone();
                let mut last_emit_at = Instant::now();
                let mut last_emitted_bytes = 0_u64;
                let min_emit_interval = Duration::from_millis(100);
                let min_emit_delta_bytes = 256 * 1024;

                node.fetch_collection_to_dir(&ticket_for_task, &tmp_dir, |bytes| {
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

                    let _ = app_for_progress.emit(
                        "transfer:progress",
                        TransferProgressEvent {
                            session_id: session_for_progress.clone(),
                            package_id: package_for_progress.clone(),
                            transferred_bytes: clamped_bytes,
                            total_bytes,
                            file_name: None,
                        },
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

                let _ = app_handle.emit(
                    "transfer:progress",
                    TransferProgressEvent {
                        session_id: session_for_task.clone(),
                        package_id: package_for_task.clone(),
                        transferred_bytes: transferred,
                        total_bytes,
                        file_name: Some(file_name),
                    },
                );
            }

            std::fs::create_dir_all(&output_dir).map_err(|err| {
                format!(
                    "failed to create output dir {}: {err}",
                    output_dir.display()
                )
            })?;

            for src in exported {
                let relative = src.strip_prefix(&tmp_dir).map_err(|_| {
                    format!("failed to compute relative path for {}", src.display())
                })?;
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

            let _ = std::fs::remove_dir_all(&tmp_dir);
            Ok::<(), String>(())
        }
        .await;

        match result {
            Ok(()) => {
                let _ = app_handle.emit(
                    "transfer:progress",
                    TransferProgressEvent {
                        session_id: session_for_task.clone(),
                        package_id: package_for_task.clone(),
                        transferred_bytes: total_bytes,
                        total_bytes,
                        file_name: None,
                    },
                );
                let _ = app_handle.emit(
                    "transfer:completed",
                    TransferCompletedEvent {
                        session_id: session_for_task.clone(),
                        package_id: package_for_task.clone(),
                        download_dir: Some(output_dir.display().to_string()),
                    },
                );
            }
            Err(message) => {
                let _ = std::fs::remove_dir_all(&tmp_dir);
                let _ = app_handle.emit(
                    "transfer:error",
                    TransferErrorEvent {
                        session_id: session_for_task.clone(),
                        package_id: Some(package_for_task.clone()),
                        code: "download_failed".to_string(),
                        message,
                    },
                );
            }
        }

        if let Ok(mut downloads) = downloads_map.lock() {
            downloads.remove(&session_for_task);
        }
        if let Ok(mut sessions) = sessions_map.lock() {
            sessions.remove(&session_for_task);
        }
    });

    {
        let mut downloads = state
            .downloads
            .lock()
            .map_err(|_| "downloads lock poisoned".to_string())?;
        downloads.insert(session_id.clone(), task);
    }

    Ok(PackageDownloadResponse {
        session_id,
        package_id,
    })
}

#[tauri::command]
fn transfer_cancel(
    session_id: String,
    state: State<'_, IrohAppState>,
) -> Result<CancelResponse, String> {
    let maybe_task = {
        let mut downloads = state
            .downloads
            .lock()
            .map_err(|_| "downloads lock poisoned".to_string())?;
        downloads.remove(&session_id)
    };
    let was_running = maybe_task.is_some();

    if let Some(task) = maybe_task {
        task.abort();
    }
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&session_id);
    }

    Ok(CancelResponse { ok: was_running })
}

async fn run_provider_event_bridge(
    mut rx: tokio::sync::mpsc::Receiver<ProviderMessage>,
    app: tauri::AppHandle,
    sessions: Arc<Mutex<HashMap<String, SessionMeta>>>,
    hash_to_session: Arc<Mutex<HashMap<String, String>>>,
    throttle_delay: Duration,
) {
    let mut connection_peers: HashMap<u64, String> = HashMap::new();

    while let Some(msg) = rx.recv().await {
        match msg {
            ProviderMessage::ClientConnectedNotify(event) => {
                if let Some(peer) = event.inner.endpoint_id {
                    connection_peers.insert(event.inner.connection_id, peer.to_string());
                }
            }
            ProviderMessage::GetRequestReceivedNotify(event) => {
                let hash = event.inner.request.hash.to_string();
                let app_handle = app.clone();
                let sessions_map = sessions.clone();
                let session_lookup = hash_to_session.clone();
                let peers = connection_peers.clone();
                let connection_id = event.inner.connection_id;
                let mut updates = event.rx;
                tauri::async_runtime::spawn(async move {
                    let maybe_session_id = session_lookup
                        .lock()
                        .ok()
                        .and_then(|map| map.get(&hash).cloned());

                    let Some(session_id) = maybe_session_id else {
                        return;
                    };

                    let Some((package_id, total_bytes)) =
                        sessions_map.lock().ok().and_then(|map| {
                            map.get(&session_id)
                                .map(|meta| (meta.package_id.clone(), meta.total_bytes))
                        })
                    else {
                        return;
                    };

                    if let Some(peer) = peers.get(&connection_id) {
                        let _ = app_handle.emit(
                            "transfer:peer-connected",
                            TransferPeerConnectedEvent {
                                session_id: session_id.clone(),
                                package_id: package_id.clone(),
                                peer_id: peer.clone(),
                            },
                        );
                    }

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
            }
            ProviderMessage::GetManyRequestReceivedNotify(event) => {
                if let Some(first_hash) = event.inner.request.hashes.first() {
                    let app_handle = app.clone();
                    let sessions_map = sessions.clone();
                    let session_lookup = hash_to_session.clone();
                    let peers = connection_peers.clone();
                    let connection_id = event.inner.connection_id;
                    let requested_hash = first_hash.to_string();
                    let mut updates = event.rx;
                    tauri::async_runtime::spawn(async move {
                        let maybe_session_id = session_lookup
                            .lock()
                            .ok()
                            .and_then(|map| map.get(&requested_hash).cloned());

                        let Some(session_id) = maybe_session_id else {
                            return;
                        };

                        let Some((package_id, total_bytes)) =
                            sessions_map.lock().ok().and_then(|map| {
                                map.get(&session_id)
                                    .map(|meta| (meta.package_id.clone(), meta.total_bytes))
                            })
                        else {
                            return;
                        };

                        if let Some(peer) = peers.get(&connection_id) {
                            let _ = app_handle.emit(
                                "transfer:peer-connected",
                                TransferPeerConnectedEvent {
                                    session_id: session_id.clone(),
                                    package_id: package_id.clone(),
                                    peer_id: peer.clone(),
                                },
                            );
                        }

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

    let _ = app.emit(
        "transfer:progress",
        TransferProgressEvent {
            session_id: session_id.to_string(),
            package_id: package_id.to_string(),
            transferred_bytes,
            total_bytes,
            file_name: None,
        },
    );

    if completed {
        let _ = app.emit(
            "transfer:completed",
            TransferCompletedEvent {
                session_id: session_id.to_string(),
                package_id: package_id.to_string(),
                download_dir: None,
            },
        );
    }
}

fn next_id(prefix: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let seq = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{now}-{seq}")
}

fn sum_file_sizes(files: &[PathBuf]) -> Result<u64, String> {
    files.iter().try_fold(0_u64, |acc, path| {
        let metadata = std::fs::metadata(path)
            .map_err(|err| format!("failed to stat {}: {err}", path.display()))?;
        Ok(acc.saturating_add(metadata.len()))
    })
}

fn infer_mime_type(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mime = match ext.as_str() {
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    };

    mime.to_string()
}

fn resolve_download_dir(download_dir: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = download_dir {
        if let Some(home) = std::env::var_os("HOME") {
            if path == "~" {
                return Ok(PathBuf::from(home));
            }
            if let Some(stripped) = path.strip_prefix("~/") {
                return Ok(PathBuf::from(home).join(stripped));
            }
        }
        return Ok(PathBuf::from(path));
    }

    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home).join("Downloads"));
    }

    Err("unable to resolve default download directory".to_string())
}

fn download_staging_dir(session_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("quicksend-recv")
        .join(format!("session-{session_id}"))
}

fn settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let settings_root = if let Ok(raw) = std::env::var("QUICKSEND_CONFIG_DIR") {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    } else {
        None
    };

    let root = if let Some(path) = settings_root {
        path
    } else {
        app.path()
            .app_config_dir()
            .map_err(|err| format!("failed to resolve app config dir: {err}"))?
    };

    Ok(root.join("settings.json"))
}

fn configured_throttle_delay() -> Duration {
    let ms = std::env::var("QUICKSEND_THROTTLE_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    Duration::from_millis(ms)
}

fn cleanup_iroh_node_dir(path: &Path) {
    if let Err(err) = std::fs::remove_dir_all(path) {
        if err.kind() == std::io::ErrorKind::NotFound {
            return;
        }
        eprintln!("failed to remove iroh node dir {}: {err}", path.display());
    }
}

fn cancel_all_downloads(state: &IrohAppState) {
    let tasks = {
        let mut downloads = state
            .downloads
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        downloads.drain().map(|(_, task)| task).collect::<Vec<_>>()
    };
    for task in tasks {
        task.abort();
    }
    let mut sessions = state.sessions.lock().unwrap_or_else(|err| err.into_inner());
    sessions.clear();
}

fn build_source_files(
    files: Vec<String>,
    roots: Option<Vec<String>>,
) -> Result<Vec<SourceFile>, String> {
    let canonical_roots = if let Some(values) = roots {
        let mut roots = Vec::new();
        for raw in values {
            if raw.is_empty() {
                continue;
            }
            let canonical = std::fs::canonicalize(&raw)
                .map_err(|err| format!("failed to canonicalize {raw}: {err}"))?;
            roots.push(canonical);
        }
        roots.sort_by_key(|path| path.as_os_str().len());
        roots.into_iter().fold(Vec::new(), |mut acc, root| {
            if acc.iter().any(|parent: &PathBuf| root.starts_with(parent)) {
                return acc;
            }
            acc.push(root);
            acc
        })
    } else {
        Vec::new()
    };

    let mut results = Vec::new();
    for raw in files {
        let path = std::fs::canonicalize(&raw)
            .map_err(|err| format!("failed to canonicalize {raw}: {err}"))?;
        let name = match find_relative_name(&path, &canonical_roots)? {
            Some(value) => value,
            None => path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| format!("invalid UTF-8 file name: {}", path.display()))?
                .to_owned(),
        };
        results.push(SourceFile { path, name });
    }
    Ok(results)
}

fn find_relative_name(path: &Path, roots: &[PathBuf]) -> Result<Option<String>, String> {
    for root in roots {
        if path == root {
            return Ok(None);
        }
        if path.starts_with(root) {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| format!("failed to derive relative path for {}", path.display()))?;
            let mut parts = Vec::new();
            for part in relative.components() {
                let value = part
                    .as_os_str()
                    .to_str()
                    .ok_or_else(|| format!("invalid UTF-8 path segment: {}", path.display()))?;
                if value.is_empty() {
                    continue;
                }
                parts.push(value);
            }
            if parts.is_empty() {
                return Ok(None);
            }
            return Ok(Some(parts.join("/")));
        }
    }
    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            inspect_files,
            package_create,
            package_preview,
            logs_dir,
            open_logs_dir,
            settings_load,
            settings_save,
            clipboard_ticket,
            package_download,
            transfer_cancel
        ])
        .setup(|app| {
            let instance_id = next_id("iroh");
            let node_dir = std::env::temp_dir()
                .join("quicksend")
                .join("iroh-node")
                .join(instance_id);
            let (node, events_rx) =
                tauri::async_runtime::block_on(IrohNode::start_with_events(&node_dir, true))?;

            let sessions = Arc::new(Mutex::new(HashMap::new()));
            let hash_to_session = Arc::new(Mutex::new(HashMap::new()));
            let downloads = Arc::new(Mutex::new(HashMap::new()));
            let throttle_delay = configured_throttle_delay();

            tauri::async_runtime::spawn(run_provider_event_bridge(
                events_rx,
                app.handle().clone(),
                sessions.clone(),
                hash_to_session.clone(),
                throttle_delay,
            ));

            app.manage(IrohAppState {
                node: tokio::sync::Mutex::new(Some(Arc::new(node))),
                sessions,
                hash_to_session,
                downloads,
                node_dir,
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<IrohAppState>() {
                cancel_all_downloads(&state);
                let node = tauri::async_runtime::block_on(async {
                    let mut guard = state.node.lock().await;
                    guard.take()
                });
                let node_dir = state.node_dir.clone();
                if let Some(node) = node {
                    match Arc::try_unwrap(node) {
                        Ok(node) => {
                            if let Err(err) = tauri::async_runtime::block_on(node.shutdown()) {
                                eprintln!("failed to shutdown iroh node cleanly: {err}");
                            }
                        }
                        Err(_) => {
                            eprintln!("skipping iroh shutdown: node still has active references");
                        }
                    }
                }
                cleanup_iroh_node_dir(&node_dir);
            }
        }
    });
}
