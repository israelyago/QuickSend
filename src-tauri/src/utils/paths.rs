use std::path::{Path, PathBuf};

use tauri::Manager;

pub fn resolve_logs_target(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

pub fn resolve_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME") {
        return Some(PathBuf::from(home));
    }
    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        return Some(PathBuf::from(user_profile));
    }
    let home_drive = std::env::var_os("HOMEDRIVE");
    let home_path = std::env::var_os("HOMEPATH");
    match (home_drive, home_path) {
        (Some(drive), Some(path)) => Some(PathBuf::from(format!(
            "{}{}",
            drive.to_string_lossy(),
            path.to_string_lossy()
        ))),
        _ => None,
    }
}

pub fn resolve_default_download_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().download_dir() {
        return Ok(path);
    }
    if let Some(home) = resolve_home_dir() {
        return Ok(home.join("Downloads"));
    }
    Err("unable to resolve default download directory".to_string())
}

pub fn resolve_download_dir(
    app: &tauri::AppHandle,
    download_dir: Option<String>,
) -> Result<PathBuf, String> {
    let default = resolve_default_download_dir(app)?;
    Ok(resolve_download_dir_from_parts(
        download_dir.as_deref(),
        resolve_home_dir().as_deref(),
        &default,
    ))
}

pub fn download_staging_dir(session_id: &str) -> PathBuf {
    std::env::temp_dir()
        .join("quicksend-recv")
        .join(format!("session-{session_id}"))
}

pub fn settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn resolve_download_dir_from_parts(
    download_dir: Option<&str>,
    home: Option<&Path>,
    default: &Path,
) -> PathBuf {
    if let Some(raw) = download_dir {
        let path = raw.trim();
        if path.is_empty() {
            return default.to_path_buf();
        }
        if let Some(home) = home {
            if path == "~" {
                return home.to_path_buf();
            }
            if let Some(stripped) = path.strip_prefix("~/") {
                return home.join(stripped);
            }
            if let Some(stripped) = path.strip_prefix("~\\") {
                return home.join(stripped);
            }
        }
        return PathBuf::from(path);
    }

    default.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::{download_staging_dir, resolve_download_dir_from_parts};
    use std::path::{Path, PathBuf};

    #[test]
    fn resolves_download_dir_with_tilde_prefix() {
        let home = Path::new("/tmp/home");
        let default = Path::new("/tmp/default");
        let resolved =
            resolve_download_dir_from_parts(Some("~/Downloads/test"), Some(home), default);
        assert_eq!(resolved, PathBuf::from("/tmp/home/Downloads/test"));
    }

    #[test]
    fn resolves_download_dir_to_default_for_empty_value() {
        let default = Path::new("/tmp/default");
        let resolved = resolve_download_dir_from_parts(Some("   "), None, default);
        assert_eq!(resolved, PathBuf::from("/tmp/default"));
    }

    #[test]
    fn download_staging_dir_contains_session_id() {
        let session_id = "abc-123";
        let path = download_staging_dir(session_id);
        let rendered = path.display().to_string();
        assert!(rendered.contains("quicksend-recv"));
        assert!(rendered.contains("session-abc-123"));
    }
}
