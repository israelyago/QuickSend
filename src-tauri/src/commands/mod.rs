use tauri::{State, Wry};
use tauri_plugin_clipboard_manager::Clipboard;

use crate::{
    api::dto::{
        CancelResponse, LocalFileInfo, PackageCreateResponse, PackageDownloadResponse,
        PackagePrepareFinalizeResponse, PackagePrepareStartResponse, PackagePreviewResponse,
        PersistedSettings,
    },
    services::{prepare, settings, transfer},
    state::IrohAppState,
    utils::{files::expand_input_paths, mime::infer_mime_type},
};

#[tauri::command]
pub async fn ping() -> &'static str {
    tokio::task::yield_now().await;
    "pong"
}

#[tauri::command]
pub fn inspect_files(files: Vec<String>) -> Result<Vec<LocalFileInfo>, String> {
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

#[tauri::command]
pub async fn package_create(
    files: Vec<String>,
    roots: Option<Vec<String>>,
    app: tauri::AppHandle,
    state: State<'_, IrohAppState>,
) -> Result<PackageCreateResponse, String> {
    transfer::package_create(files, roots, app, &state).await
}

#[tauri::command]
pub async fn package_prepare_start(
    files: Vec<String>,
    roots: Option<Vec<String>>,
    app: tauri::AppHandle,
    state: State<'_, IrohAppState>,
) -> Result<PackagePrepareStartResponse, String> {
    prepare::package_prepare_start(files, roots, app, &state).await
}

#[tauri::command]
pub async fn package_prepare_finalize(
    prepare_session_id: String,
    state: State<'_, IrohAppState>,
) -> Result<PackagePrepareFinalizeResponse, String> {
    prepare::package_prepare_finalize(prepare_session_id, &state).await
}

#[tauri::command]
pub fn package_prepare_cancel(
    prepare_session_id: String,
    state: State<'_, IrohAppState>,
) -> Result<CancelResponse, String> {
    prepare::package_prepare_cancel(prepare_session_id, &state)
}

#[tauri::command]
pub fn package_prepare_remove_file(
    prepare_session_id: String,
    file_id: String,
    state: State<'_, IrohAppState>,
) -> Result<CancelResponse, String> {
    prepare::package_prepare_remove_file(prepare_session_id, file_id, &state)
}

#[tauri::command]
pub async fn package_preview(
    ticket: String,
    state: State<'_, IrohAppState>,
) -> Result<PackagePreviewResponse, String> {
    transfer::package_preview(ticket, &state).await
}

#[tauri::command]
pub fn logs_dir(app: tauri::AppHandle) -> Result<String, String> {
    settings::logs_dir(&app)
}

#[tauri::command]
pub fn open_logs_dir(app: tauri::AppHandle) -> Result<String, String> {
    settings::open_logs_dir(&app)
}

#[tauri::command]
pub fn settings_load(app: tauri::AppHandle) -> Result<PersistedSettings, String> {
    settings::settings_load(&app)
}

#[tauri::command]
pub fn settings_save(app: tauri::AppHandle, settings: PersistedSettings) -> Result<(), String> {
    settings::settings_save(&app, settings)
}

#[tauri::command]
pub fn clipboard_ticket(clipboard: State<'_, Clipboard<Wry>>) -> Result<Option<String>, String> {
    let text = clipboard.read_text().map_err(|err| err.to_string())?;
    let trimmed = text.trim();
    if trimmed.starts_with("blob") {
        Ok(Some(trimmed.to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn package_download(
    ticket: String,
    package_id: Option<String>,
    download_dir: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, IrohAppState>,
) -> Result<PackageDownloadResponse, String> {
    transfer::package_download(ticket, package_id, download_dir, app, &state).await
}

#[tauri::command]
pub fn transfer_cancel(
    session_id: String,
    state: State<'_, IrohAppState>,
) -> Result<crate::api::dto::CancelResponse, String> {
    transfer::transfer_cancel(session_id, &state)
}
