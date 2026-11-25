//! Judging writes: the row each table is written as, and the batch it lands in.
//!
//! `EvaluationService.write_results` groups the results it receives by object
//! and by operation type before it touches the database, so a dataset and a
//! submission result are read once per group rather than once per result. The
//! four shapes here are what that commit writes: the result row that tracks how
//! far one submission has got, the executable set one compilation produced, the
//! evaluation rows one testcase run produced, and the score fields
//! `ScoringService` fills in last. User-test operations write
//! `user_test_results` instead, and are not part of these shapes.
//!
//! Every statement is a column-exact constant naming only the columns the shape
//! beside it declares, and every statement takes one placeholder per column: the
//! two result statements upsert on the composite key the way
//! `get_result_or_create` does, and the two row sets bind one array per column
//! so that a whole object is written in a single round trip.
//!
//! Nothing here opens a connection. These are the statements, the grouping that
//! decides which rows go down together, and the audit rows that must accompany
//! them.
//!
//! The four files below hold one concern each, so that the statements, the rows
//! they write, the batch that carries them and the commit that lands them are
//! read apart:
//!
//! - `statements`: the four column-exact statements.
//! - `shapes`: the row each table is written as, and the two enum values its
//!   outcome columns accept.
//! - `batch`: the grouping that merges operations into a batch, and the audit
//!   rows every batch must carry.
//! - `commit`: the one transaction that executes the statements for a batch.
//!
//! # Errors
//!
//! [`WriteError::MissingAudit`] refuses a batch carrying no audit row:
//! [`group_by_object`], [`ObjectWrite::seal`] and [`commit`] all apply it, so a
//! mutation cannot be written unrecorded. [`commit`] also surfaces a statement
//! or transaction the driver refused as [`CommitError::Database`].

mod batch;
mod commit;
mod shapes;
mod statements;

pub use batch::{group_by_object, AuditRow, ObjectWrite, OperationType, RowState, WriteError};
pub use commit::{commit, CommitError};
pub use shapes::{
    CompilationOutcome, EvaluationOutcome, EvaluationRow, ExecutableRow, ResultRow, ScoreRow,
};
pub use statements::{INSERT_EVALUATIONS, INSERT_EXECUTABLES, UPSERT_RESULT, UPSERT_SCORE};
