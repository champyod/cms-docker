//! Answers already underway, so a stop lets the reply it interrupted reach its caller.

use std::sync::{Condvar, Mutex, PoisonError};

/// How many frames are being answered right now.
///
/// Only a frame handed to `converse` counts, never the blocking read before it: an
/// idle connection holds nothing, which is what lets a stop come back while one is open.
#[derive(Debug, Default)]
pub(super) struct InFlight {
    count: Mutex<usize>,
    is_idle: Condvar,
}

impl InFlight {
    /// Counts this frame as underway until the guard drops.
    pub(super) fn guard(&self) -> Guard<'_> {
        *self.lock() += 1;
        Guard { in_flight: self }
    }

    /// Blocks until no frame is underway; a stop calls this so a reply is written before the process goes.
    pub(super) fn wait_until_idle(&self) {
        let mut count = self.lock();
        while *count > 0 {
            count = self
                .is_idle
                .wait(count)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    /// A panic while holding a counter cannot corrupt it, so a poisoned lock is still read and written.
    fn lock(&self) -> std::sync::MutexGuard<'_, usize> {
        self.count.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// One frame's presence in the count, released however the frame ends.
pub(super) struct Guard<'a> {
    in_flight: &'a InFlight,
}

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        let mut count = self.in_flight.lock();
        *count -= 1;
        if *count == 0 {
            self.in_flight.is_idle.notify_all();
        }
    }
}
