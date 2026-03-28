use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::SystemTime,
};

use crate::iroh::IrohNode;

#[derive(Clone)]
pub struct SessionMeta {
    pub package_id: String,
    pub total_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferLifecycleState {
    Preparing,
    Transferring,
    Finalizing,
    Completed,
    Failed,
    Cancelled,
}

impl TransferLifecycleState {
    fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Preparing, Self::Transferring)
                | (Self::Preparing, Self::Failed)
                | (Self::Preparing, Self::Cancelled)
                | (Self::Transferring, Self::Finalizing)
                | (Self::Transferring, Self::Failed)
                | (Self::Transferring, Self::Cancelled)
                | (Self::Finalizing, Self::Completed)
                | (Self::Finalizing, Self::Failed)
                | (Self::Finalizing, Self::Cancelled)
        )
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Clone)]
pub struct TransferRegistry {
    sessions: Arc<Mutex<HashMap<String, SessionMeta>>>,
    hash_to_session: Arc<Mutex<HashMap<String, String>>>,
    downloads: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    lifecycle: Arc<Mutex<HashMap<String, TransferLifecycleState>>>,
}

impl TransferRegistry {
    pub fn new(
        sessions: Arc<Mutex<HashMap<String, SessionMeta>>>,
        hash_to_session: Arc<Mutex<HashMap<String, String>>>,
        downloads: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    ) -> Self {
        Self {
            sessions,
            hash_to_session,
            downloads,
            lifecycle: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn insert_session(&self, session_id: String, meta: SessionMeta) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "sessions lock poisoned".to_string())?;
        sessions.insert(session_id.clone(), meta);

        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "lifecycle lock poisoned".to_string())?;
        lifecycle.insert(session_id, TransferLifecycleState::Preparing);
        Ok(())
    }

    pub fn get_session(&self, session_id: &str) -> Option<SessionMeta> {
        self.sessions
            .lock()
            .ok()
            .and_then(|map| map.get(session_id).cloned())
    }

    pub fn remove_session(&self, session_id: &str) -> Option<SessionMeta> {
        self.sessions
            .lock()
            .ok()
            .and_then(|mut map| map.remove(session_id))
    }

    pub fn map_hash_to_session(&self, hash: String, session_id: String) -> Result<(), String> {
        let mut lookup = self
            .hash_to_session
            .lock()
            .map_err(|_| "hash map lock poisoned".to_string())?;
        lookup.insert(hash, session_id);
        Ok(())
    }

    pub fn lookup_session_by_hash(&self, hash: &str) -> Option<String> {
        self.hash_to_session
            .lock()
            .ok()
            .and_then(|map| map.get(hash).cloned())
    }

    pub fn resolve_transfer_context(&self, hash: &str) -> Option<(String, String, u64)> {
        let session_id = self.lookup_session_by_hash(hash)?;
        let meta = self.get_session(&session_id)?;
        Some((session_id, meta.package_id, meta.total_bytes))
    }

    pub fn get_lifecycle_state(&self, session_id: &str) -> Option<TransferLifecycleState> {
        self.lifecycle
            .lock()
            .ok()
            .and_then(|map| map.get(session_id).copied())
    }

    pub fn transition_state(
        &self,
        session_id: &str,
        next: TransferLifecycleState,
    ) -> Result<bool, String> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "lifecycle lock poisoned".to_string())?;

        let Some(current) = lifecycle.get(session_id).copied() else {
            return Ok(false);
        };

        if current == next {
            return Ok(true);
        }

        if !current.can_transition_to(next) {
            return Ok(false);
        }

        lifecycle.insert(session_id.to_string(), next);
        Ok(true)
    }

    pub fn insert_download(
        &self,
        session_id: String,
        task: tauri::async_runtime::JoinHandle<()>,
    ) -> Result<(), String> {
        let mut downloads = self
            .downloads
            .lock()
            .map_err(|_| "downloads lock poisoned".to_string())?;
        downloads.insert(session_id, task);
        Ok(())
    }

    pub fn remove_download(
        &self,
        session_id: &str,
    ) -> Option<tauri::async_runtime::JoinHandle<()>> {
        self.downloads
            .lock()
            .ok()
            .and_then(|mut map| map.remove(session_id))
    }

    pub fn abort_download(&self, session_id: &str) -> Result<bool, String> {
        let maybe_task = self.remove_download(session_id);
        let was_running = maybe_task.is_some();
        if let Some(task) = maybe_task {
            task.abort();
        }
        Ok(was_running)
    }

    pub fn cancel_session(&self, session_id: &str) -> Result<bool, String> {
        let _ = self.transition_state(session_id, TransferLifecycleState::Cancelled)?;
        let was_running = self.abort_download(session_id)?;
        self.cleanup_session(session_id);
        Ok(was_running)
    }

    pub fn cleanup_session(&self, session_id: &str) {
        let _ = self.remove_download(session_id);
        let _ = self.remove_session(session_id);
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            lifecycle.remove(session_id);
        }
        if let Ok(mut lookup) = self.hash_to_session.lock() {
            lookup.retain(|_, mapped_session| mapped_session != session_id);
        }
    }

    pub fn drain_downloads(&self) -> Vec<tauri::async_runtime::JoinHandle<()>> {
        let mut downloads = self.downloads.lock().unwrap_or_else(|err| err.into_inner());
        downloads.drain().map(|(_, task)| task).collect::<Vec<_>>()
    }

    pub fn clear_sessions(&self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|err| err.into_inner());
        sessions.clear();
    }

    pub fn cancel_all(&self) {
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            for state in lifecycle.values_mut() {
                if !state.is_terminal() {
                    *state = TransferLifecycleState::Cancelled;
                }
            }
        }

        let tasks = self.drain_downloads();
        for task in tasks {
            task.abort();
        }

        self.clear_sessions();

        let mut lookup = self
            .hash_to_session
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        lookup.clear();

        let mut lifecycle = self.lifecycle.lock().unwrap_or_else(|err| err.into_inner());
        lifecycle.clear();
    }
}

pub struct IrohAppState {
    pub node: tokio::sync::Mutex<Option<Arc<IrohNode>>>,
    pub registry: TransferRegistry,
    pub prepare_registry: PrepareRegistry,
    pub node_dir: PathBuf,
}

pub fn cancel_all_downloads(state: &IrohAppState) {
    state.registry.cancel_all();
    state.prepare_registry.cancel_all();
}

#[derive(Clone)]
pub struct PrepareSessionMeta {
    pub package_id: String,
    pub started_at: SystemTime,
    pub files: Vec<PrepareFileState>,
    pub imported_hashes: Vec<(String, String)>,
    pub emit_sequence: u64,
}

impl PrepareSessionMeta {
    pub fn new(package_id: String) -> Self {
        Self {
            package_id,
            started_at: SystemTime::now(),
            files: Vec::new(),
            imported_hashes: Vec::new(),
            emit_sequence: 0,
        }
    }

    pub fn with_files(package_id: String, files: Vec<PrepareFileState>) -> Self {
        Self {
            package_id,
            started_at: SystemTime::now(),
            files,
            imported_hashes: Vec::new(),
            emit_sequence: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrepareFileLifecycleState {
    Queued,
    Importing,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug)]
pub struct PrepareFileState {
    pub file_id: String,
    pub name: String,
    pub path: String,
    pub status: PrepareFileLifecycleState,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
    pub hash: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrepareLifecycleState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl PrepareLifecycleState {
    fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Queued, Self::Running)
                | (Self::Queued, Self::Failed)
                | (Self::Queued, Self::Cancelled)
                | (Self::Running, Self::Completed)
                | (Self::Running, Self::Failed)
                | (Self::Running, Self::Cancelled)
        )
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Clone)]
pub struct PrepareRegistry {
    sessions: Arc<Mutex<HashMap<String, PrepareSessionMeta>>>,
    lifecycle: Arc<Mutex<HashMap<String, PrepareLifecycleState>>>,
    tasks: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    cancel_requests: Arc<Mutex<HashSet<String>>>,
    remove_requests: Arc<Mutex<HashMap<String, HashSet<String>>>>,
}

impl PrepareRegistry {
    pub fn new(sessions: Arc<Mutex<HashMap<String, PrepareSessionMeta>>>) -> Self {
        Self {
            sessions,
            lifecycle: Arc::new(Mutex::new(HashMap::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            cancel_requests: Arc::new(Mutex::new(HashSet::new())),
            remove_requests: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn insert_session(
        &self,
        session_id: String,
        meta: PrepareSessionMeta,
    ) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "prepare sessions lock poisoned".to_string())?;
        sessions.insert(session_id.clone(), meta);

        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "prepare lifecycle lock poisoned".to_string())?;
        lifecycle.insert(session_id, PrepareLifecycleState::Queued);
        Ok(())
    }

    pub fn get_session(&self, session_id: &str) -> Option<PrepareSessionMeta> {
        self.sessions
            .lock()
            .ok()
            .and_then(|map| map.get(session_id).cloned())
    }

    pub fn remove_session(&self, session_id: &str) -> Option<PrepareSessionMeta> {
        self.sessions
            .lock()
            .ok()
            .and_then(|mut map| map.remove(session_id))
    }

    pub fn get_lifecycle_state(&self, session_id: &str) -> Option<PrepareLifecycleState> {
        self.lifecycle
            .lock()
            .ok()
            .and_then(|map| map.get(session_id).copied())
    }

    pub fn transition_state(
        &self,
        session_id: &str,
        next: PrepareLifecycleState,
    ) -> Result<bool, String> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "prepare lifecycle lock poisoned".to_string())?;

        let Some(current) = lifecycle.get(session_id).copied() else {
            return Ok(false);
        };

        if current == next {
            return Ok(true);
        }

        if !current.can_transition_to(next) {
            return Ok(false);
        }

        lifecycle.insert(session_id.to_string(), next);
        Ok(true)
    }

    pub fn update_session<F>(&self, session_id: &str, update: F) -> Result<bool, String>
    where
        F: FnOnce(&mut PrepareSessionMeta),
    {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "prepare sessions lock poisoned".to_string())?;
        let Some(session) = sessions.get_mut(session_id) else {
            return Ok(false);
        };
        update(session);
        Ok(true)
    }

    pub fn register_task(
        &self,
        session_id: String,
        task: tauri::async_runtime::JoinHandle<()>,
    ) -> Result<(), String> {
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|_| "prepare tasks lock poisoned".to_string())?;
        tasks.insert(session_id, task);
        Ok(())
    }

    pub fn take_task(&self, session_id: &str) -> Option<tauri::async_runtime::JoinHandle<()>> {
        self.tasks
            .lock()
            .ok()
            .and_then(|mut map| map.remove(session_id))
    }

    pub fn request_cancel(&self, session_id: &str) -> Result<bool, String> {
        if self.get_session(session_id).is_none() {
            return Ok(false);
        }

        let mut cancel_requests = self
            .cancel_requests
            .lock()
            .map_err(|_| "prepare cancel requests lock poisoned".to_string())?;
        cancel_requests.insert(session_id.to_string());
        Ok(true)
    }

    pub fn is_cancel_requested(&self, session_id: &str) -> bool {
        self.cancel_requests
            .lock()
            .ok()
            .map(|set| set.contains(session_id))
            .unwrap_or(false)
    }

    pub fn request_remove_file(&self, session_id: &str, file_id: &str) -> Result<bool, String> {
        if self.get_session(session_id).is_none() {
            return Ok(false);
        }

        let mut remove_requests = self
            .remove_requests
            .lock()
            .map_err(|_| "prepare remove requests lock poisoned".to_string())?;
        remove_requests
            .entry(session_id.to_string())
            .or_default()
            .insert(file_id.to_string());
        Ok(true)
    }

    pub fn take_remove_file_request(
        &self,
        session_id: &str,
        file_id: &str,
    ) -> Result<bool, String> {
        let mut remove_requests = self
            .remove_requests
            .lock()
            .map_err(|_| "prepare remove requests lock poisoned".to_string())?;
        let Some(files) = remove_requests.get_mut(session_id) else {
            return Ok(false);
        };
        let removed = files.remove(file_id);
        if files.is_empty() {
            remove_requests.remove(session_id);
        }
        Ok(removed)
    }

    pub fn cancel_session(&self, session_id: &str) -> Result<bool, String> {
        self.request_cancel(session_id)
    }

    pub fn cleanup_session(&self, session_id: &str) {
        if let Some(task) = self.take_task(session_id) {
            task.abort();
        }
        let _ = self.remove_session(session_id);
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            lifecycle.remove(session_id);
        }
        if let Ok(mut cancel_requests) = self.cancel_requests.lock() {
            cancel_requests.remove(session_id);
        }
        if let Ok(mut remove_requests) = self.remove_requests.lock() {
            remove_requests.remove(session_id);
        }
    }

    pub fn cancel_all(&self) {
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            for state in lifecycle.values_mut() {
                if !state.is_terminal() {
                    *state = PrepareLifecycleState::Cancelled;
                }
            }
            lifecycle.clear();
        }

        if let Ok(mut tasks) = self.tasks.lock() {
            for (_, task) in tasks.drain() {
                task.abort();
            }
        }

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
        if let Ok(mut cancel_requests) = self.cancel_requests.lock() {
            cancel_requests.clear();
        }
        if let Ok(mut remove_requests) = self.remove_requests.lock() {
            remove_requests.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_registry() -> TransferRegistry {
        TransferRegistry::new(
            Arc::new(Mutex::new(HashMap::new())),
            Arc::new(Mutex::new(HashMap::new())),
            Arc::new(Mutex::new(HashMap::new())),
        )
    }

    #[test]
    fn lifecycle_transitions_are_enforced() {
        let registry = make_registry();
        registry
            .insert_session(
                "s1".to_string(),
                SessionMeta {
                    package_id: "p1".to_string(),
                    total_bytes: 42,
                },
            )
            .expect("insert session");

        assert_eq!(
            registry.get_lifecycle_state("s1"),
            Some(TransferLifecycleState::Preparing)
        );
        assert!(registry
            .transition_state("s1", TransferLifecycleState::Transferring)
            .expect("transition to transferring"));
        assert!(registry
            .transition_state("s1", TransferLifecycleState::Finalizing)
            .expect("transition to finalizing"));
        assert!(registry
            .transition_state("s1", TransferLifecycleState::Completed)
            .expect("transition to completed"));
        assert!(!registry
            .transition_state("s1", TransferLifecycleState::Failed)
            .expect("completed must be terminal"));
    }

    #[tokio::test]
    async fn cancel_session_aborts_task_and_cleans_lookup() {
        let registry = make_registry();
        registry
            .insert_session(
                "s2".to_string(),
                SessionMeta {
                    package_id: "p2".to_string(),
                    total_bytes: 100,
                },
            )
            .expect("insert session");
        registry
            .map_hash_to_session("h2".to_string(), "s2".to_string())
            .expect("map hash");

        let task = tauri::async_runtime::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        });
        registry
            .insert_download("s2".to_string(), task)
            .expect("insert download");

        let was_running = registry.cancel_session("s2").expect("cancel session");
        assert!(was_running);
        assert!(registry.get_session("s2").is_none());
        assert!(registry.lookup_session_by_hash("h2").is_none());
        assert!(registry.remove_download("s2").is_none());
        assert!(registry.get_lifecycle_state("s2").is_none());
    }

    #[test]
    fn cleanup_session_removes_only_matching_hash_mappings() {
        let registry = make_registry();
        registry
            .insert_session(
                "s3".to_string(),
                SessionMeta {
                    package_id: "p3".to_string(),
                    total_bytes: 1,
                },
            )
            .expect("insert s3");
        registry
            .insert_session(
                "s4".to_string(),
                SessionMeta {
                    package_id: "p4".to_string(),
                    total_bytes: 2,
                },
            )
            .expect("insert s4");

        registry
            .map_hash_to_session("h3".to_string(), "s3".to_string())
            .expect("map h3");
        registry
            .map_hash_to_session("h4".to_string(), "s4".to_string())
            .expect("map h4");

        registry.cleanup_session("s3");

        assert!(registry.lookup_session_by_hash("h3").is_none());
        assert_eq!(
            registry.lookup_session_by_hash("h4"),
            Some("s4".to_string())
        );
    }

    #[tokio::test]
    async fn cancel_all_drains_tasks_sessions_and_lookups() {
        let registry = make_registry();

        for (session_id, package_id, hash) in [("s5", "p5", "h5"), ("s6", "p6", "h6")] {
            registry
                .insert_session(
                    session_id.to_string(),
                    SessionMeta {
                        package_id: package_id.to_string(),
                        total_bytes: 7,
                    },
                )
                .expect("insert session");
            registry
                .map_hash_to_session(hash.to_string(), session_id.to_string())
                .expect("map hash");
            registry
                .insert_download(
                    session_id.to_string(),
                    tauri::async_runtime::spawn(async {
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }),
                )
                .expect("insert download");
        }

        registry.cancel_all();

        assert!(registry.get_session("s5").is_none());
        assert!(registry.get_session("s6").is_none());
        assert!(registry.lookup_session_by_hash("h5").is_none());
        assert!(registry.lookup_session_by_hash("h6").is_none());
        assert!(registry.remove_download("s5").is_none());
        assert!(registry.remove_download("s6").is_none());
    }

    #[tokio::test]
    async fn cancel_all_downloads_cleans_state_on_shutdown() {
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let hash_to_session = Arc::new(Mutex::new(HashMap::new()));
        let downloads = Arc::new(Mutex::new(HashMap::new()));
        let registry = TransferRegistry::new(sessions, hash_to_session, downloads);

        registry
            .insert_session(
                "s7".to_string(),
                SessionMeta {
                    package_id: "p7".to_string(),
                    total_bytes: 10,
                },
            )
            .expect("insert session");
        registry
            .map_hash_to_session("h7".to_string(), "s7".to_string())
            .expect("map hash");
        registry
            .insert_download(
                "s7".to_string(),
                tauri::async_runtime::spawn(async {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }),
            )
            .expect("insert download");

        let state = IrohAppState {
            node: tokio::sync::Mutex::new(None),
            registry: registry.clone(),
            prepare_registry: make_prepare_registry(),
            node_dir: std::env::temp_dir().join("quicksend-test-node-dir"),
        };

        cancel_all_downloads(&state);

        assert!(registry.get_session("s7").is_none());
        assert!(registry.lookup_session_by_hash("h7").is_none());
        assert!(registry.remove_download("s7").is_none());
    }

    fn make_prepare_registry() -> PrepareRegistry {
        PrepareRegistry::new(Arc::new(Mutex::new(HashMap::new())))
    }

    #[test]
    fn prepare_lifecycle_transitions_are_enforced() {
        let registry = make_prepare_registry();
        let session = PrepareSessionMeta::new("pkg-1".to_string());
        registry
            .insert_session("prep-1".to_string(), session)
            .expect("insert prepare session");

        assert_eq!(
            registry.get_lifecycle_state("prep-1"),
            Some(PrepareLifecycleState::Queued)
        );
        assert!(registry
            .transition_state("prep-1", PrepareLifecycleState::Running)
            .expect("queued -> running"));
        assert!(registry
            .transition_state("prep-1", PrepareLifecycleState::Completed)
            .expect("running -> completed"));
        assert!(!registry
            .transition_state("prep-1", PrepareLifecycleState::Cancelled)
            .expect("completed is terminal"));
    }

    #[test]
    fn prepare_cancel_and_cleanup_remove_session() {
        let registry = make_prepare_registry();
        let session = PrepareSessionMeta::new("pkg-2".to_string());
        registry
            .insert_session("prep-2".to_string(), session)
            .expect("insert prepare session");

        assert!(registry.cancel_session("prep-2").expect("cancel session"));
        assert!(registry.is_cancel_requested("prep-2"));
        registry.cleanup_session("prep-2");
        assert!(registry.get_session("prep-2").is_none());
        assert!(registry.get_lifecycle_state("prep-2").is_none());
    }
}
