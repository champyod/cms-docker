//! How long a worker worked and how long it stood idle, as one value.
//!
//! `Worker._finalize` keeps six fields on the worker — when the last request
//! ended, the two running totals, the number of requests, and the fake time it
//! was configured with — and closes every request against them, whether the
//! request did work or was declined because the worker was already busy. They are
//! one value here, [`Accounting`], so the fields cannot drift apart, and what one
//! request cost is one value, [`BusyReport`], rather than five numbers a caller
//! has to know the order of.
//!
//! # The means are corrected, and the first line is still all busy
//!
//! The reference counts a request after it divides the totals, so its first line
//! reports a mean of zero and its second line the mean of one line rather than of
//! two. Here the request is counted first, so every line reports the mean over
//! every line closed so far. That is a deliberate break from the reference, and
//! the corrected means are pinned by the suite rather than left to be re-derived.
//!
//! The first line is fully busy either way, and that part is left as the
//! reference has it: idle is measured as the gap after the previous request, and
//! a worker that has run nothing yet has no previous request to have been idle
//! after, so the whole of its first line is work. A clock with nothing measured
//! on it at all has no share to report, which is `None` here rather than the
//! division by zero the reference raises.
//!
//! # Errors
//!
//! None: closing a request reads two clock readings the caller already took and
//! reports what they mean, so there is nothing here to refuse.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

/// What a clock that is busy the whole time reads as.
const PERCENT_FULL: f64 = 100.0;

/// What one closed request cost the worker, and what it had cost before it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BusyReport {
    /// Seconds this request was executing, from the moment it was received to
    /// the moment it was answered.
    pub busy_seconds: f64,
    /// Seconds between the previous request being answered and this one being
    /// received, which is zero on the first line: there is no previous request to
    /// have been idle after.
    pub free_seconds: f64,
    /// Share of the clock this worker has been busy over, as a percentage, or
    /// `None` while nothing at all has been measured on it.
    pub busy_percent: Option<f64>,
    /// Mean idle seconds per request closed so far, `None` while there are none.
    pub mean_free_seconds: Option<f64>,
    /// Mean executing seconds per request closed so far, `None` while there are
    /// none.
    pub mean_busy_seconds: Option<f64>,
}

/// The seconds a worker has spent working and standing idle, across its requests.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Accounting {
    /// When the request before this one was answered, and the idle of the next
    /// request is the gap from here to when it arrived.
    last_end: Option<f64>,
    total_busy: f64,
    total_free: f64,
    requests: u32,
}

impl Accounting {
    /// An accounting that has closed no request yet.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            last_end: None,
            total_busy: 0.0,
            total_free: 0.0,
            requests: 0,
        }
    }

    /// Closes a request that ran from `start` to `end`, and says what it cost.
    ///
    /// Both are seconds off one monotonic clock, read once each: `start` when the
    /// request is received and `end` when it is answered. A request is closed
    /// exactly once, whatever it did in between, and the idle it is charged is the
    /// gap after the request before it — so a request that was declined because
    /// the worker was already busy is still closed, and is still charged for the
    /// idle it was declined in.
    pub fn close(&mut self, start: f64, end: f64) -> BusyReport {
        let busy_seconds = end - start;
        let free_seconds = self.free_since(start);
        self.last_end = Some(end);
        self.total_busy += busy_seconds;
        self.total_free += free_seconds;
        self.requests += 1;
        BusyReport {
            busy_seconds,
            free_seconds,
            busy_percent: self.busy_percent(),
            mean_free_seconds: self.mean_of(self.total_free),
            mean_busy_seconds: self.mean_of(self.total_busy),
        }
    }

    /// Share of the clock this worker has been busy over, as a percentage, or
    /// `None` while nothing at all has been measured on it.
    fn busy_percent(&self) -> Option<f64> {
        let clock = self.total_busy + self.total_free;
        if clock > 0.0 {
            Some(self.total_busy * PERCENT_FULL / clock)
        } else {
            None
        }
    }

    /// A running total over the requests closed so far, which is nothing to
    /// divide while no request has been closed.
    fn mean_of(&self, total: f64) -> Option<f64> {
        if self.requests > 0 {
            Some(total / f64::from(self.requests))
        } else {
            None
        }
    }

    /// The idle a request arriving at `start` is charged: the gap after the
    /// request before it, and zero when there was none.
    fn free_since(&self, start: f64) -> f64 {
        self.last_end.map_or(0.0, |last_end| start - last_end)
    }
}

impl Default for Accounting {
    fn default() -> Self {
        Self::new()
    }
}
