use tauri_plugin_opener::OpenerExt;

use crate::{
    api::dto::PersistedSettings,
    utils::paths::{resolve_default_download_dir, resolve_logs_target, settings_file_path},
};

pub fn logs_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let path = resolve_logs_target(app)?;
    Ok(path.display().to_string())
}

pub fn open_logs_dir(app: &tauri::AppHandle) -> Result<String, String> {
    let path = resolve_logs_target(app)?;
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

pub fn settings_load(app: &tauri::AppHandle) -> Result<PersistedSettings, String> {
    let defaults = default_settings(app)?;
    let file = settings_file_path(app)?;
    if !file.exists() {
        return Ok(defaults);
    }

    let content = std::fs::read_to_string(&file)
        .map_err(|err| format!("failed to read settings file {}: {err}", file.display()))?;
    let mut parsed = serde_json::from_str::<PersistedSettings>(&content)
        .map_err(|err| format!("failed to parse settings file {}: {err}", file.display()))?;
    if parsed.download_dir.trim().is_empty() {
        parsed.download_dir = defaults.download_dir;
    }
    Ok(parsed)
}

pub fn settings_save(app: &tauri::AppHandle, settings: PersistedSettings) -> Result<(), String> {
    let file = settings_file_path(app)?;
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

fn default_settings(app: &tauri::AppHandle) -> Result<PersistedSettings, String> {
    let download_dir = resolve_default_download_dir(app)?;
    Ok(PersistedSettings {
        download_dir: download_dir.display().to_string(),
        theme: "system".to_string(),
        auto_download_max_bytes: 1024 * 1024 * 1024,
        auto_install_updates: true,
        size_unit: "jedec".to_string(),
    })
}
