//! The batch one object is written in, and the audit rows it must carry.
//!
//! [`group_by_object`] mirrors `write_results`: results are keyed by object and
//! operation type, which is what lets the commit read a dataset and a
//! submission result once per group instead of once per result. A batch is one
//! object and one operation type, holding every row the statements beside it
//! need, plus the audit rows that record who made the change and what it
//! changed.
//!
//! Both [`group_by_object`] and [`ObjectWrite::seal`] refuse a batch with no
//! audit row, so nothing here can be handed to the statements unrecorded.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;
use std::fmt;

use crate::reads::ResultKey;

use super::shapes::{EvaluationRow, ExecutableRow, ResultRow, ScoreRow};

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
        /// The object the batch would have written.
        key: ResultKey,
    },
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingAudit { key } => write!(
                f,
                "no audit row for submission {} on dataset {}",
                key.submission_id, key.dataset_id
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
    /// The object and the dataset: the key every row in the batch carries.
    pub key: ResultKey,
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
    /// Closes the batch for writing.
    ///
    /// # Errors
    ///
    /// Returns [`WriteError::MissingAudit`] when the batch carries no audit row,
    /// which is what stops a mutation from reaching the database without the
    /// record of who made it and what it changed.
    pub fn seal(self) -> Result<Self, WriteError> {
        if self.audit.is_empty() {
            return Err(WriteError::MissingAudit { key: self.key });
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
    let mut groups: BTreeMap<(OperationType, i32, i32), ObjectWrite> = BTreeMap::new();
    for write in writes {
        if write.audit.is_empty() {
            return Err(WriteError::MissingAudit { key: write.key });
        }
        let key = (
            write.operation,
            write.key.submission_id,
            write.key.dataset_id,
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
