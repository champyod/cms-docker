//! The batch one object is written in, and the audit rows it must carry.
//!
//! [`group_by_object`] mirrors `write_results`: results are keyed by object,
//! operation type and archiving flag, which is what lets the commit read a
//! dataset and a submission result once per group instead of once per result.
//! A batch is one object, one operation and one archiving flag, holding every
//! row the statements beside it need, plus the audit rows that record who made
//! the change and what it changed.
//!
//! Both [`group_by_object`] and [`ObjectWrite::seal`] refuse a batch with no
//! audit row, so nothing here can be handed to the statements unrecorded.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;
use std::fmt;

use sqlx::postgres::PgConnection;

use super::shapes::{EvaluationRow, ExecutableRow, ResultRow, ScoreRow};
use super::statements::INSERT_EVALUATIONS;
use crate::reads::{DatasetId, SubmissionId};

/// Which half of a judging commit one group belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum OperationType {
    /// `ESOperation.COMPILATION`: producing the executables of one dataset.
    Compilation,
    /// `ESOperation.EVALUATION`: running one testcase of one dataset.
    Evaluation,
}

/// One row as an audit row records it: the state the batch found, and the state
/// it writes in its place.
#[derive(Debug, Clone, PartialEq)]
pub enum RowState {
    /// The object result row of one submission on one dataset.
    Result(ResultRow),
    /// One testcase run.
    Evaluation(EvaluationRow),
    /// One compiled file.
    Executable(ExecutableRow),
    /// The score fields of one result.
    Score(ScoreRow),
    /// The result row of one user test on one dataset.
    UserTestResult(crate::writes::UserTestResultRow),
    /// One file a user-test compilation produced.
    UserTestExecutable(crate::writes::UserTestExecutableRow),
}

/// One mutation, as the audit store records it: who made it, what verb they
/// used, which row it landed on, and the two states of that row.
#[derive(Debug, Clone, PartialEq)]
pub struct AuditRow {
    /// `audit_log.actor_id`: the admin the change is attributed to, absent when
    /// a service made the change on its own.
    pub actor_id: Option<i32>,
    /// `audit_log.verb`.
    pub verb: String,
    /// `audit_log.entity`: the table the change lands in.
    pub entity: String,
    /// `audit_log.entity_id`: the row's own key, a composite key included.
    pub entity_id: String,
    /// The row as the batch found it, absent when the batch creates the row.
    pub before: Option<RowState>,
    /// The row the batch writes.
    pub after: RowState,
    /// `audit_log.reason`, why the change was made.
    pub reason: String,
}

/// Why a batch was refused before it reached the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteError {
    /// The batch carried no audit row, so nothing would record the change.
    MissingAudit {
        /// The submission whose object the batch would have written.
        submission_id: SubmissionId,
        /// The dataset that object was measured against.
        dataset_id: DatasetId,
    },
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingAudit {
                submission_id,
                dataset_id,
            } => write!(
                f,
                "no audit row for submission {submission_id} on dataset {dataset_id}"
            ),
        }
    }
}

impl std::error::Error for WriteError {}

/// The rows one object is written as: what one finished operation contributes,
/// and what every operation on the same object and operation type adds up to.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectWrite {
    /// Which half of the commit the rows belong to.
    pub operation: OperationType,
    /// The submission the object belongs to, which every row in the batch carries.
    pub submission_id: SubmissionId,
    /// The dataset the object was measured against, which every row in the batch
    /// carries.
    pub dataset_id: DatasetId,
    /// Whether the operation archived its sandboxes, part of the key the same
    /// object is grouped by.
    pub archive_sandbox: bool,
    /// The result row the object's progress is written to.
    pub result: ResultRow,
    /// The executable set one successful compilation produced.
    pub executables: Vec<ExecutableRow>,
    /// One row per testcase the object ran.
    pub evaluations: Vec<EvaluationRow>,
    /// The score fields, once the scoring pass has filled them in.
    pub score: Option<ScoreRow>,
    /// The rows the change is recorded as. A batch needs at least one.
    pub audit: Vec<AuditRow>,
}

impl ObjectWrite {
    /// Writes one object's evaluation rows in one statement, one bound array
    /// per column; each of the three `varchar[]` columns carries a per-row list.
    ///
    /// # Errors
    ///
    /// Returns the driver's own error for a statement it could not run.
    pub async fn write_evaluations(
        connection: &mut PgConnection,
        rows: &[EvaluationRow],
    ) -> Result<(), sqlx::Error> {
        let bound = BoundEvaluations::of(rows);
        sqlx::query(INSERT_EVALUATIONS)
            .bind(bound.submission_id)
            .bind(bound.dataset_id)
            .bind(bound.testcase_id)
            .bind(bound.outcome)
            .bind(bound.text)
            .bind(bound.admin_text)
            .bind(bound.execution_time)
            .bind(bound.execution_wall_clock_time)
            .bind(bound.execution_memory)
            .bind(bound.evaluation_shard)
            .bind(bound.evaluation_sandbox_paths)
            .bind(bound.evaluation_sandbox_digests)
            .execute(connection)
            .await?;
        Ok(())
    }

    /// Closes the batch for writing.
    ///
    /// # Errors
    ///
    /// Returns [`WriteError::MissingAudit`] when the batch carries no audit row,
    /// which is what stops a mutation from reaching the database without the
    /// record of who made it and what it changed.
    pub fn seal(self) -> Result<Self, WriteError> {
        if self.audit.is_empty() {
            return Err(WriteError::MissingAudit {
                submission_id: self.submission_id,
                dataset_id: self.dataset_id,
            });
        }
        Ok(self)
    }

    /// Folds one operation into the batch its object is written in.
    ///
    /// The later result row replaces the earlier one, which is the state the
    /// reference's single fetched object would have held once both ran; the
    /// evaluation and executable rows accumulate, because each testcase run and
    /// each compiled file is a row of its own.
    fn merge(&mut self, other: &Self) {
        self.result = other.result.clone();
        self.evaluations.extend(other.evaluations.iter().cloned());
        self.executables.extend(other.executables.iter().cloned());
        self.audit.extend(other.audit.iter().cloned());
        if other.score.is_some() {
            self.score.clone_from(&other.score);
        }
    }
}

/// The `evaluations` columns bound as one array each, in statement order.
struct BoundEvaluations {
    submission_id: Vec<i32>,
    dataset_id: Vec<i32>,
    testcase_id: Vec<i32>,
    outcome: Vec<Option<String>>,
    text: Vec<Option<String>>,
    admin_text: Vec<Option<String>>,
    execution_time: Vec<Option<f64>>,
    execution_wall_clock_time: Vec<Option<f64>>,
    execution_memory: Vec<Option<i64>>,
    evaluation_shard: Vec<Option<i32>>,
    evaluation_sandbox_paths: Vec<Option<String>>,
    evaluation_sandbox_digests: Vec<Option<String>>,
}

impl BoundEvaluations {
    /// Flattens one row set into the per-column arrays `unnest` pairs up.
    fn of(rows: &[EvaluationRow]) -> Self {
        Self {
            submission_id: rows.iter().map(|row| row.submission_id.0).collect(),
            dataset_id: rows.iter().map(|row| row.dataset_id.0).collect(),
            testcase_id: rows.iter().map(|row| row.testcase_id).collect(),
            outcome: rows.iter().map(|row| row.outcome.clone()).collect(),
            text: rows.iter().map(|row| Some(row.text_literal())).collect(),
            admin_text: rows.iter().map(|row| row.admin_text.clone()).collect(),
            execution_time: rows.iter().map(|row| row.execution_time).collect(),
            execution_wall_clock_time: rows
                .iter()
                .map(|row| row.execution_wall_clock_time)
                .collect(),
            execution_memory: rows.iter().map(|row| row.execution_memory).collect(),
            evaluation_shard: rows.iter().map(|row| row.evaluation_shard).collect(),
            evaluation_sandbox_paths: rows
                .iter()
                .map(EvaluationRow::sandbox_paths_literal)
                .collect(),
            evaluation_sandbox_digests: rows
                .iter()
                .map(EvaluationRow::sandbox_digests_literal)
                .collect(),
        }
    }
}

/// Merges every operation on the same object and operation type into the batch
/// that object is written in.
///
/// Batches come back in the order the keys sort, so the same operations always
/// produce the same statements in the same sequence.
///
/// # Errors
///
/// Returns [`WriteError::MissingAudit`] for the first operation that carries no
/// audit row, so no batch reaches the statements without the record of who made
/// the change and what it changed.
pub fn group_by_object(writes: &[ObjectWrite]) -> Result<Vec<ObjectWrite>, WriteError> {
    let mut groups: BTreeMap<(OperationType, SubmissionId, DatasetId, bool), ObjectWrite> =
        BTreeMap::new();
    for write in writes {
        if write.audit.is_empty() {
            return Err(WriteError::MissingAudit {
                submission_id: write.submission_id,
                dataset_id: write.dataset_id,
            });
        }
        let key = (
            write.operation,
            write.submission_id,
            write.dataset_id,
            write.archive_sandbox,
        );
        match groups.entry(key) {
            Entry::Occupied(mut found) => found.get_mut().merge(write),
            Entry::Vacant(slot) => {
                slot.insert(write.clone());
            }
        }
    }
    Ok(groups.into_values().collect())
}
