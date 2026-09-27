//! The one file a job cannot have, and the flags that refusal is reported with.
//!
//! Detection is not this module's to make. The digest mapping already refuses the
//! tombstone — [`CacheHandle::open`] answers [`CacheError::Tombstone`] before any
//! store is asked where a file is — so [`content_digest`] asks that mapping and
//! names the refusal it made, and the knowledge that a digest can be the
//! tombstone stays where it already lives.
//!
//! What is this module's is the disposal: turning that refusal into the pair of
//! flags the job is reported with, `success` false and the tombstone marker set.
//! The reference writes those two into the job it exports and moves on to the next
//! job in the group, so the refusal is a result and not an error. Any other
//! refusal is raised, which is what the reference does with everything but the
//! tombstone.
//!
//! The order matters as much as the mapping, and it is the reference's: the task
//! type is looked up before the guard is opened, so a dataset naming a task type
//! the worker does not have fails the whole group and can never be reported as a
//! tombstone. [`resolve_task_type`] and [`dispose`] are two functions for that
//! reason, so the order is the shape of the code rather than the order two lines
//! happen to be written in.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;

use cms_db::{CacheError, CacheHandle, FileDigest};

/// Why a job could not be run, or could not be run to the end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobError {
    /// The dataset names a task type this worker does not have. The reference
    /// looks the task type up before it opens the tombstone guard, so this is
    /// raised for the whole group and never reported as a job result.
    UnknownTaskType {
        /// Name the dataset gives, which is the name to look for in the worker's
        /// configuration.
        name: String,
    },
    /// A file the job needs is the tombstone, so its content is gone and there is
    /// nothing to work from. This is [`cms_db::CacheError::Tombstone`] under a
    /// name that says what it costs the job, so [`dispose`] can map it to a
    /// result rather than raise it.
    Tombstone,
}

impl fmt::Display for JobError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownTaskType { name } => {
                write!(f, "no task type named `{name}` is available to this worker")
            }
            Self::Tombstone => write!(f, "a file the job needs is the tombstone"),
        }
    }
}

impl std::error::Error for JobError {}

/// The flags one job is reported back with: whether it succeeded, and the marker
/// that says why it did not.
///
/// These are the two keys the reference writes into the job it exports, held as
/// fields so a result is a value the compiler carries rather than a dictionary a
/// caller has to know the shape of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobResult {
    /// `job.success`.
    pub success: bool,
    /// `job.plus["tombstone"]`. False on a job that succeeded, where the
    /// reference leaves the key out of the dictionary entirely.
    pub tombstone: bool,
}

impl JobResult {
    /// A job whose work ran to the end.
    pub const COMPLETED: Self = Self {
        success: true,
        tombstone: false,
    };

    /// A job cut short by the tombstone: unsuccessful, and carrying the marker
    /// that says a file it needed is gone rather than that the work went wrong.
    pub const REFUSED_BY_TOMBSTONE: Self = Self {
        success: false,
        tombstone: true,
    };
}

/// The task type a job names, taken from the ones this worker has.
///
/// `get_task_type` in the reference. The reference calls it before it opens the
/// tombstone guard, and keeping the lookup in its own function is what keeps that
/// order: a dataset naming a task type the worker does not have is raised here,
/// where no job has been started and so no result can carry the marker.
///
/// # Errors
///
/// [`JobError::UnknownTaskType`], naming the task type the dataset gave.
pub fn resolve_task_type<'a>(name: &str, available: &'a [String]) -> Result<&'a str, JobError> {
    available
        .iter()
        .map(String::as_str)
        .find(|known| *known == name)
        .ok_or_else(|| JobError::UnknownTaskType {
            name: name.to_owned(),
        })
}

/// The digest one of a job's files is to be read at, which is where the tombstone
/// is refused.
///
/// The refusal is the digest mapping's decision and stays there: this asks
/// [`CacheHandle::open`] and reports the refusal it made as [`JobError::Tombstone`],
/// so every caller reaches the same answer whoever wrote the handle.
///
/// # Errors
///
/// [`JobError::Tombstone`] for a handle naming the tombstone, which
/// [`CacheHandle::open`] reports as [`CacheError::Tombstone`].
pub fn content_digest(handle: &CacheHandle) -> Result<&FileDigest, JobError> {
    handle.open().map_err(|refusal| match refusal {
        CacheError::Tombstone => JobError::Tombstone,
    })
}

/// Runs a job's work and disposes of it, answering the flags it is reported with.
///
/// `work` is what the task type does with the files it needs, and the guard around
/// it is the reference's `except TombstoneError`. A job stopped by the tombstone
/// is not a failure of the worker: it is reported as unsuccessful with the marker
/// set, and the caller runs the next job in the group. Every other refusal is
/// raised, as the reference raises everything but the tombstone.
///
/// # Errors
///
/// Whatever `work` refuses with, other than the tombstone, which is answered as
/// [`JobResult::REFUSED_BY_TOMBSTONE`] instead of raised.
pub fn dispose<W>(work: W) -> Result<JobResult, JobError>
where
    W: FnOnce() -> Result<(), JobError>,
{
    match work() {
        Ok(()) => Ok(JobResult::COMPLETED),
        Err(JobError::Tombstone) => Ok(JobResult::REFUSED_BY_TOMBSTONE),
        Err(refusal) => Err(refusal),
    }
}
