//! The worker: one request at a time, and what a request costs the worker.
//!
//! A run is launched and measured by `cms_sandbox`, and what a submission is worth
//! is decided by `cms_grading`; neither is this crate's answer. What is left here
//! is the loop a request goes through and the bookkeeping around it.
//!
//! [`edge`] holds both halves of what a request decides around the work rather
//! than inside it: the tombstone a job is reported for instead of being failed on,
//! and the seconds a worker spent working against the seconds it stood idle.
//!
//! [`service`] is the loop one request goes through: the worker is taken without
//! waiting and a request that finds it busy is declined rather than queued, each
//! job is stamped with the shard that ran it and dispatched through the disposal
//! that turns a tombstone into a result, and the request is charged to the clock
//! and the worker released whichever way it left.
//!
//! # Errors
//!
//! [`cms_db::CacheError`], [`edge::JobError`] and [`service::ServiceError`], and
//! nothing else: a digest no store holds, the tombstone, a dataset naming a task
//! type this worker does not have, and a request declined because the worker was
//! busy. Every other refusal belongs to the work itself, and the accounting cannot
//! be refused at all.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod edge;
pub mod service;
