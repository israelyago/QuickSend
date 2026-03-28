use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn next_id(prefix: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let seq = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{now}-{seq}")
}

#[cfg(test)]
mod tests {
    use super::next_id;

    #[test]
    fn next_id_includes_prefix_and_changes() {
        let a = next_id("test");
        let b = next_id("test");
        assert!(a.starts_with("test-"));
        assert!(b.starts_with("test-"));
        assert_ne!(a, b);
    }
}
