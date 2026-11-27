//! Judging writes: the row each table is written as, and the batch it lands in.
//!
//! `EvaluationService.write_results` groups the results it receives by object
//! and by operation type before it touches the database, so a dataset and a
//! submission result are read once per group rather than once per result. The
//! four shapes here are what that commit writes: the result row that tracks how
//! far one submission has got, the executable set one compilation produced, the
//! evaluation rows one testcase run produced, and the score fields
//! `ScoringService` fills in last. User-test operations write
//! `user_test_results` instead, and are not part of these shapes. Its write
//! path is the sibling module `usertest`, which writes the result row and the
//! user-test executables without an evaluation row or a score.
//!
//! Every statement is a column-exact constant naming only the columns the shape
//! beside it declares, and every statement takes one placeholder per column: the
//! two result statements upsert on the composite key the way
//! `get_result_or_create` does, and the two row sets bind one array per column
//! so that a whole object is written in a single round trip.
//!
//! Nothing here opens a connection. These are the statements, the grouping that
//! decides which rows go down together, and the audit rows a batch declares.
//! Appending those audit rows is the caller's work, through the one writer that
//! computes the hash chain; this layer refuses to store them unchained.
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
//! - `commit`: the one transaction that executes the statements for a batch and
//!   refuses to store audit rows it cannot chain.
//! - `usertest`: the user-test result row, its executable set and its commit.
//!
//! # Errors
//!
//! [`group_by_object`] and [`ObjectWrite::seal`] refuse a batch carrying no
//! audit row: `seal` is the batch's declaration that it must be recorded.
//! [`commit`] refuses to store that declaration outside the chain, returning
//! [`CommitError::AuditNotWired`] for any batch that carries audit rows. A
//! statement the driver refused surfaces as [`CommitError::Database`].

mod batch;
mod commit;
mod shapes;
mod statements;
mod usertest;

pub use batch::{group_by_object, AuditRow, ObjectWrite, OperationType, RowState, WriteError};
pub use commit::{commit, CommitError};
pub use shapes::{
    CompilationOutcome, EvaluationOutcome, EvaluationRow, ExecutableRow, ResultRow, ScoreRow,
};
pub use statements::{
    CLEAR_SCORE_FOR_COMPILATION, INSERT_EVALUATIONS, INSERT_EXECUTABLES, UPSERT_RESULT,
    UPSERT_SCORE,
};
pub use usertest::{
    commit_user_test, UserTestExecutableRow, UserTestOperation, UserTestResultRow, UserTestWrite,
    DELETE_USER_TEST_EXECUTABLES, INSERT_USER_TEST_EXECUTABLES, UPSERT_USER_TEST_RESULT,
};
