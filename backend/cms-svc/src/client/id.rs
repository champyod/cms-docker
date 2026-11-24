//! Correlation ids unique within this process, without a uuid dependency.

use std::process;
use std::sync::atomic::{AtomicU64, Ordering};

/// Process-local sequence; the pid keeps concurrent processes in separate namespaces.
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Returns a hexadecimal process id and sequence pair.
pub(super) fn next_id() -> String {
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("{:x}-{:x}", process::id(), sequence)
}
