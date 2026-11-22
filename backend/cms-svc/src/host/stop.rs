//! A stop request: the flag `run` reads, and whether the stop wants a non-zero exit.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// A request to stop a host, raiseable from any thread that holds a clone.
#[derive(Debug, Clone)]
pub struct Stop(Arc<Flags>);

impl Stop {
    /// A stop nobody has raised yet.
    #[must_use]
    pub fn new() -> Self {
        Self(Arc::new(Flags::default()))
    }

    /// Asks the host to come back and exit zero.
    pub fn request(&self) {
        self.0.is_requested.store(true, Ordering::SeqCst);
    }

    /// Asks the host to come back and exit non-zero, so a supervisor restarts the service.
    pub fn request_fatally(&self) {
        // WHY: the exit is recorded before the request, so a `run` that sees the stop already owes the code.
        self.0.is_fatal.store(true, Ordering::SeqCst);
        self.0.is_requested.store(true, Ordering::SeqCst);
    }

    /// Whether the host has been asked to come back.
    #[must_use]
    pub fn is_requested(&self) -> bool {
        self.0.is_requested.load(Ordering::SeqCst)
    }

    /// Whether the stop that was asked for owes a non-zero exit.
    #[must_use]
    pub fn is_fatal(&self) -> bool {
        self.0.is_fatal.load(Ordering::SeqCst)
    }
}

impl Default for Stop {
    fn default() -> Self {
        Self::new()
    }
}

/// The two flags one stop is made of, shared by every clone of it.
#[derive(Debug, Default)]
struct Flags {
    is_requested: AtomicBool,
    is_fatal: AtomicBool,
}
