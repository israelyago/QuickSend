use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
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
    pub node_dir: PathBuf,
}

pub fn cancel_all_downloads(state: &IrohAppState) {
    state.registry.cancel_all();
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
            node_dir: std::env::temp_dir().join("quicksend-test-node-dir"),
        };

        cancel_all_downloads(&state);

        assert!(registry.get_session("s7").is_none());
        assert!(registry.lookup_session_by_hash("h7").is_none());
        assert!(registry.remove_download("s7").is_none());
    }
}
