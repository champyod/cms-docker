//! The measuring worker: what a sandboxed run leaves behind.
//!
//! The first thing a worker has to answer is what a run it ran actually did —
//! how long it was charged for, how long it took, how much memory it wanted,
//! why it stopped and what it printed — and every later decision is made from
//! that answer. [`ExecutionLog`] and [`ExitStatus`] are the log a run wrote and
//! the seven statuses its codes can mean, and [`ExecutionStats`] is that answer
//! as one value plus the figures several runs fold into. They are the only
//! things here yet.
//!
//! A run may log several codes at once, so the status is decided by a fixed
//! precedence — `XX` over `TO` over `SG` over `RE`, with the `OK` a log never
//! writes — and two of the seven are reached by reading one further key: a stop
//! is a wall-clock one when the message says so, and a kill is the memory limit
//! when the isolate recorded an out-of-memory kill.
//!
//! Nothing here launches anything on its own. A measurement is decided from a log
//! a caller already has, so a wall-clock stop, an out-of-memory kill and a merge of
//! concurrent runs are all decided by text rather than waited for.
//!
//! Launching a run is the other half, and it is the one thing that starts a
//! process. [`sandbox::Sandbox`] hands a command to the isolation program, keeps
//! both its pipes empty while it runs so a run that prints more than a pipe holds
//! cannot block and never finish, and answers with the run's figures, why it ended
//! and what it printed. The limits a run is held to are the ones it was launched
//! with, which the isolation program enforces: [`sandbox::Options`] is where they
//! are said, and [`sandbox::Outcome`] is the reading of the code the launch
//! returned — a code that says only that the isolation program worked, never what
//! the run inside it did.
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
//! # Errors
//!
//! [`MeasureError`], [`StageError`], [`CacheError`], [`edge::JobError`],
//! [`service::ServiceError`], [`sandbox::SpawnError`] and
//! [`tasktypes::TaskError`], and nothing else: a line that names no key, a value
//! that is not the number its key promises, a path already staged, a path with no
//! file, a digest no store holds, a task type this worker does not have, the
//! tombstone, a request declined because the worker was busy, a run that could not
//! be launched, a pipe that could not be read, a code the isolation program does
//! not document, and a task type's own three parameters, managers, file counts,
//! executable counts and limits. A run that measured nothing is `None`, which is
//! an answer rather than a failure.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod edge;
pub mod job;
pub mod sandbox;
pub mod service;
pub mod stage;
pub mod tasktypes;

mod measure;
mod stats;

pub use measure::{ExecutionLog, ExitStatus, MeasureError};
pub use stats::ExecutionStats;
