//! The measuring worker: what a sandboxed run leaves behind.
//!
//! The first thing a worker has to answer is what a run it ran actually did —
//! how long it was charged for, how long it took, how much memory it wanted,
//! why it stopped and what it printed — and every later decision is made from
//! that answer. The [`measure`] module is that answer and the only thing here
//! yet: an execution log read into a map, the seven statuses its codes can
//! mean, and the statistics several runs fold into.
//!
//! A run may log several codes at once, so the status is decided by a fixed
//! precedence — `XX` over `TO` over `SG` over `RE`, with the `OK` a log never
//! writes — and two of the seven are reached by reading one further key: a stop
//! is a wall-clock one when the message says so, and a kill is the memory limit
//! when the isolate recorded an out-of-memory kill.
//!
//! Nothing here launches anything. A measurement is decided from a log a caller
//! already has, so a wall-clock stop, an out-of-memory kill and a merge of
//! concurrent runs are all decided by text rather than waited for, and no
//! process, file or clock is involved in producing one.
//!
//! # Errors
//!
//! [`measure::MeasureError`], and only that: a line that names no key, and a
//! value that is not the number its key promises. A run that measured nothing
//! is `None`, which is an answer rather than a failure.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod measure;

pub use measure::{ExecutionLog, ExecutionStats, ExitStatus, MeasureError};
