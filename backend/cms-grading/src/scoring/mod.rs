//! What a participation's submissions are worth on one task.
//!
//! A score here is never derived: a score type already decided what each submission is worth,
//! and this module decides which of those numbers the task's score mode reads. [`Submission`]
//! and its [`ResultColumns`] are values rather than a database read — `cms-db`'s result record
//! carries none of the score columns, and a caller that read a result holds them anyway — so
//! every mode is exercised with no database, no clock and no rows.
//!
//! The three modes are one function each because they disagree about the same thing: what an
//! unscored submission is worth. [`max`] and [`max_subtask`] never see one; [`max_tokened_last`]
//! reads the last submission as zero when it is unscored, because that submission is half of
//! the answer rather than an entry in a maximum.
//!
//! # Panics
//!
//! [`max_tokened_last`], and only that: it is asked about a participation with no submission,
//! which the aggregation never does.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod modes;
mod participation;

pub use modes::{max, max_subtask, max_tokened_last};
pub use participation::{Contribution, Counted, ResultColumns, Submission, SubmittedAt};
