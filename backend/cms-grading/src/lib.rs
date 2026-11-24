//! What a submission is handed, what its run is worth, and where its files go.
//!
//! A job arrives as four constructors rather than one builder, because the four
//! disagree with each other and the disagreements are the behaviour: [`job`] is
//! the model a service sends, the dataset and submission it is read against, and
//! the refusals each constructor makes before it builds anything.
//!
//! [`execute`] is where a typed compilation or evaluation meets the task type its
//! row names: configuration refusals become failed job results, every other
//! refusal stays an error, and optional text keeps `None` distinct from no sentences.
//!
//! What a task is made of is [`tasktypes`]: the order a job's files are handed
//! over, its runs are launched and its files are taken back in, which is the one
//! thing a task type decides and the only thing that differs between one task
//! type and the next. A language a job names and the box its runs are made in are
//! the caller's, so [`tasktypes::Toolchain`] and [`tasktypes::Runtime`] are values
//! rather than lookups and a task type can be exercised without a machine.
//!
//! [`languages`] is the registry those toolchains come from: one entry per
//! language this workspace compiles, and a lookup that answers `None` for a name
//! it does not know rather than inventing a command.
//!
//! [`limits`] is the four attempt caps: the evaluation service enforces them and the
//! dashboard counts the submissions that reached them, so one module holds both readings.
//!
//! [`scoretypes`] is what a submission is worth once its runs are judged: four score
//! types chosen by the name in a dataset's `score_type` column, the two document shapes
//! they produce, and the two formatting rules that decide what a contestant reads — the
//! task's published precision and the panel's own decimal pattern.
//!
//! What a submission is then worth is the half a task type's answer hands on.
//! [`scoring`] is the other direction: a participation's submissions in one task, and the
//! three score modes that turn them into the one number a ranking reads — the best
//! submission, each subtask's best, or the best tokened one against the last. It takes the
//! score columns as values rather than reading them, so a mode is exercised with no
//! database, and it derives no score of its own. `task_score` is what a ranking calls: it
//! reads the official submissions in the order they were sent, hands each mode the column the
//! caller asked for, and answers whether anything is still pending; `compute_changes_for_dataset`
//! is what activating a dataset asks first — which results it would move, and by how much.
//!
//! [`steps`] is the checker a dataset supplies, held to the limits that bound a
//! manager rather than a submission and read as the standard output it is required
//! to write, and the comparison of an answer with the one a dataset says is right:
//! byte for byte, or forgiving whitespace and nothing else. Both are pure, so a
//! verdict is decided by the bytes a run wrote rather than by a box of their own.
//!
//! [`messages`] is every sentence a contestant is shown for what a run did, in the
//! order the help page prints them, and the one table both surfaces read: a job's
//! report names an outcome and takes its sentence from there, so a sentence with an
//! argument cannot be handed on without one.
//!
//! The files a run is handed and leaves behind are where all of that starts and
//! ends. [`stage::Stage`] creates a run's files under the modes it will use them
//! with, refuses a path the run already has, reads a file back whole or only as
//! far as a limit reaches, and stores a result under the digest the storage
//! addresses it by. [`stage::Cache`] is that storage as one trait with a
//! directory, a database and a discarding backend behind it, and the tombstone is
//! refused once, by the digest mapping all three share.
//!
//! # Errors
//!
//! [`job::BuildError`], [`cms_sandbox::MeasureError`], [`cms_sandbox::SpawnError`],
//! [`stage::StageError`], [`stage::CacheError`], [`steps::CheckerError`],
//! [`steps::StepError`] and [`tasktypes::TaskError`], and nothing else: a
//! constructor handed an operation of another kind, a language the lookup does not
//! know, a run that could not be launched or measured, a path already staged, a
//! digest no store holds, a checker that answered with something unreadable, and a
//! task type's own parameters, managers, file counts, executable counts and
//! limits. A run that measured nothing is `None`, which is an answer rather than a
//! failure. [`scoring`]'s refusals are not errors and do not join that list: a caller asking
//! for what cannot be meant is a programming error, so it panics with the reference's own
//! message instead of returning something a caller would have to handle.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod execute;
pub mod job;
pub mod languages;
pub mod limits;
pub mod messages;
pub mod scoretypes;
pub mod scoring;
pub mod stage;
pub mod steps;
pub mod tasktypes;
