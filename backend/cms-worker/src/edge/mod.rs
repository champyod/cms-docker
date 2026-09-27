//! What a worker decides around a request, rather than the work inside it.
//!
//! Two things stand between a request arriving and a job's results going back,
//! and neither of them is the work. The first is the tombstone: a file whose
//! content was dropped to recover space names a digest that holds nothing, and a
//! job that needs it is reported as an unsuccessful job carrying a marker, not as
//! a worker that failed — the job after it in the group still runs. The second is
//! the clock: how long this request was executing, how long the worker stood
//! idle before it, and what the worker has cost in total.
//!
//! Each is one value rather than a set of fields a caller has to keep in step —
//! [`JobResult`] for the flags a job is reported with, [`Accounting`] for the
//! seconds and [`BusyReport`] for one closed request — and both keep the
//! reference's own arithmetic visible: what it catches, in what order, and the
//! two places it is wrong.
//!
//! The reference can also be configured to answer every request with fabricated
//! results instead of running anything. That mode is not carried over: it fills a
//! job with a fixed score and a fixed memory figure to load-test a service, and
//! no deployment here runs it.
//!
//! # Errors
//!
//! [`JobError`], and only that: a dataset naming a task type this worker does not
//! have, and the tombstone. Every other refusal belongs to the work itself, and
//! the accounting cannot be refused at all.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod accounting;
mod tombstone;

pub use accounting::{Accounting, BusyReport};
pub use tombstone::{content_digest, dispose, resolve_task_type, JobError, JobResult};
