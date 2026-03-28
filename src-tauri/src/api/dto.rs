#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileInfo {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub mime_type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageCreateResponse {
    pub session_id: String,
    pub package_id: String,
    pub ticket: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreviewResponse {
    pub package_id: String,
    pub files: Vec<LocalFileInfo>,
    pub total_size_bytes: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageDownloadResponse {
    pub session_id: String,
    pub package_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePrepareStartResponse {
    pub prepare_session_id: String,
    pub package_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePrepareFinalizeResponse {
    pub session_id: String,
    pub package_id: String,
    pub ticket: String,
}

#[derive(serde::Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PrepareSessionStatusDto {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(serde::Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PrepareFileStatusDto {
    Queued,
    Importing,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrepareProgressSummary {
    pub total_files: u64,
    pub completed_files: u64,
    pub failed_files: u64,
    pub cancelled_files: u64,
    pub processed_bytes: u64,
    pub total_bytes: u64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrepareFileProgress {
    pub file_id: String,
    pub name: String,
    pub path: String,
    pub status: PrepareFileStatusDto,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SendPrepareProgressEvent {
    pub prepare_session_id: String,
    pub package_id: String,
    pub status: PrepareSessionStatusDto,
    pub summary: PrepareProgressSummary,
    pub files: Vec<PrepareFileProgress>,
    pub sequence: u64,
    pub done: bool,
    pub changed_file_ids: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResponse {
    pub ok: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferPeerConnectedEvent {
    pub session_id: String,
    pub package_id: String,
    pub peer_id: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressEvent {
    pub session_id: String,
    pub package_id: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub file_name: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferCompletedEvent {
    pub session_id: String,
    pub package_id: String,
    pub download_dir: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferErrorEvent {
    pub session_id: String,
    pub package_id: Option<String>,
    pub code: String,
    pub message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSettings {
    pub download_dir: String,
    pub theme: String,
    pub auto_download_max_bytes: i64,
    pub auto_install_updates: bool,
    pub size_unit: String,
}
