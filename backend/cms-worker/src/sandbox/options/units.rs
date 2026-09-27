//! The two units the isolation program takes numbers in that a caller does not.
//!
//! A caller hands over a size in bytes and a limit as a duration, and the
//! isolation program takes neither: it takes kibibytes and seconds, and the log
//! reports memory in kibibytes too. Both conversions are here so the unit a limit
//! is written in is stated once rather than repeated at every flag that carries
//! one.
//!
//! # Errors
//!
//! None. A size too small to hold a whole kibibyte becomes zero, which is the
//! isolation program's own default written out rather than a limit of its own,
//! and a limit is a fraction of a second rather than a whole number because the
//! isolation program charges a run the time it took.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::time::Duration;

/// The bytes in the kibibyte the isolation program takes every size in.
const BYTES_PER_KIBIBYTE: u64 = 1024;

/// A size in bytes as the kibibytes the isolation program takes it in.
pub(super) const fn kibibytes(size: u64) -> u64 {
    size / BYTES_PER_KIBIBYTE
}

/// A limit as the seconds the isolation program takes it in, fractions kept.
pub(super) const fn seconds(limit: Duration) -> f64 {
    limit.as_secs_f64()
}
