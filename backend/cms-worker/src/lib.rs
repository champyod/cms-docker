//! The worker: the files a submission is handed and what its run is worth.
//!
//! A run is launched and measured by `cms_sandbox` — [`cms_sandbox::Sandbox`] asks
//! the isolation program, [`cms_sandbox::ExecutionLog`] is what it wrote, and
//! [`cms_sandbox::ExecutionStats`] is the answer a report reads — and every decision
//! here is made from that answer rather than from a clock of its own. A run that
//! failed, was stopped or was killed is an answer, not an error.
//!
//! What this crate decides is everything around that: which files a task type hands
//! over and in what order, where a run's own directory is filed, and what a
//! submission is worth.
//!
//! The files a run is handed and leaves behind are the other half of that answer.
//! [`stage::Stage`] creates a run's files under the modes it will use them with,
//! refuses a path the run already has, reads a file back whole or only as far as a
//! limit reaches, and stores a result under the digest the storage addresses it by.
//! [`stage::Cache`] is that storage as one trait with a directory, a database and a
//! discarding backend behind it, and the tombstone is refused once, by the digest
//! mapping all three share.
//!
//! What a request costs is the other half of a worker's own answer about itself.
//! [`edge`] holds both halves of what a request decides around the work rather
//! than inside it: the tombstone a job is reported for instead of being failed on,
//! and the seconds a worker spent working against the seconds it stood idle.
//!
//! What a request does with a worker is the half outside even that. [`service`]
//! is the loop one request goes through: the worker is taken without waiting and a
//! request that finds it busy is declined rather than queued, each job is stamped
//! with the shard that ran it and dispatched through the disposal that turns a
//! tombstone into a result, and the request is charged to the clock and the
//! worker released whichever way it left.
//!
//! What a task is made of is the half inside all of that. [`tasktypes`] is the
//! order a job's files are handed over, its runs are launched and its files are
//! taken back in, which is the one thing a task type decides and the only thing
//! that differs between one task type and the next. A language a job names and
//! the box its runs are made in are the caller's, so [`tasktypes::Toolchain`] and
//! [`tasktypes::Runtime`] are values rather than lookups and a task type can be
//! exercised without a machine.
//!
//! What a submission is then worth is the half a task type's answer hands on.
//! [`steps`] is the checker a dataset supplies, held to the limits that bound a
//! manager rather than a submission and read as the standard output it is required to
//! write, and the comparison of an answer with the one a dataset says is right: byte
//! for byte, or forgiving whitespace and nothing else. Both are pure, so a verdict is
//! decided by the bytes a run wrote rather than by a box of their own.
//!
//! # Errors
//!
//! [`cms_sandbox::MeasureError`], [`StageError`], [`CacheError`], [`edge::JobError`],
//! [`service::ServiceError`], [`cms_sandbox::SpawnError`], [`steps::CheckerError`],
//! [`steps::StepError`] and [`tasktypes::TaskError`], and nothing else: a line that
//! names no key, a value that is not the number its key promises, a path already
//! staged, a path with no file, a digest no store holds, a task type this worker does
//! not have, the tombstone, a request declined because the worker was busy, a run that
//! could not be launched, a pipe that could not be read, a code the isolation program
//! does not document, a checker that answered with something unreadable, a file a
//! checker could not be handed, and a task type's own parameters, managers, file
//! counts, executable counts and limits. A run that measured nothing is `None`, which
//! is an answer rather than a failure.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod edge;
pub mod job;
pub mod languages;
pub mod service;
pub mod stage;
pub mod steps;
pub mod tasktypes;
