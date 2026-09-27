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
//! # Errors
//!
//! [`WriteError::MissingAudit`] is the only error the module produces:
//! [`group_by_object`] and [`ObjectWrite::seal`] both refuse a batch carrying no
//! audit row, so a mutation cannot be written unrecorded.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;
use std::fmt;

use chrono::NaiveDateTime;

use crate::digest::FileDigest;
use crate::reads::ResultKey;

/// The `submission_results` columns one object result writes, upserted on the
/// composite key `get_result_or_create` looks the row up by.
pub const UPSERT_RESULT: &str = "\
    INSERT INTO submission_results (submission_id, dataset_id, compilation_outcome, \
        compilation_text, compilation_tries, compilation_stdout, compilation_stderr, \
        compilation_time, compilation_wall_clock_time, compilation_memory, \
        compilation_shard, compilation_sandbox_paths, compilation_sandbox_digests, \
        evaluation_outcome, evaluation_tries) \
    VALUES ($1, $2, $3::compilation_outcome, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::evaluation_outcome, $15) \
    ON CONFLICT (submission_id, dataset_id) DO UPDATE SET \
        compilation_outcome = EXCLUDED.compilation_outcome, compilation_text = EXCLUDED.compilation_text, \
        compilation_tries = EXCLUDED.compilation_tries, compilation_stdout = EXCLUDED.compilation_stdout, \
        compilation_stderr = EXCLUDED.compilation_stderr, compilation_time = EXCLUDED.compilation_time, \
        compilation_wall_clock_time = EXCLUDED.compilation_wall_clock_time, compilation_memory = EXCLUDED.compilation_memory, \
        compilation_shard = EXCLUDED.compilation_shard, compilation_sandbox_paths = EXCLUDED.compilation_sandbox_paths, \
        compilation_sandbox_digests = EXCLUDED.compilation_sandbox_digests, evaluation_outcome = EXCLUDED.evaluation_outcome, \
        evaluation_tries = EXCLUDED.evaluation_tries";

/// The `executables` columns one compilation's set writes, one array bound per
/// column so the whole set lands in one statement.
pub const INSERT_EXECUTABLES: &str = "\
    INSERT INTO executables (submission_id, dataset_id, filename, digest) \
    SELECT * FROM unnest($1::integer[], $2::integer[], $3::varchar[], $4::varchar[])";

/// The `evaluations` columns one testcase run writes, one array bound per column
/// so every testcase of one object lands in one statement.
pub const INSERT_EVALUATIONS: &str = "\
    INSERT INTO evaluations (submission_id, dataset_id, testcase_id, outcome, text, admin_text, \
        execution_time, execution_wall_clock_time, execution_memory, evaluation_shard, \
        evaluation_sandbox_paths, evaluation_sandbox_digests) \
    SELECT * FROM unnest($1::integer[], $2::integer[], $3::integer[], $4::varchar[], $5::varchar[], \
        $6::varchar[], $7::double precision[], $8::double precision[], $9::bigint[], $10::integer[], \
        $11::varchar[], $12::varchar[])";

/// The `submission_results` score columns one scoring pass writes, upserted on
/// the same key, leaving a score already stored alone until it is recomputed.
pub const UPSERT_SCORE: &str = "\
    INSERT INTO submission_results (submission_id, dataset_id, score, score_details, \
        scored_at, public_score, public_score_details, ranking_score_details) \
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8) \
    ON CONFLICT (submission_id, dataset_id) DO UPDATE SET \
        score = EXCLUDED.score, score_details = EXCLUDED.score_details, \
        scored_at = EXCLUDED.scored_at, public_score = EXCLUDED.public_score, \
        public_score_details = EXCLUDED.public_score_details, \
        ranking_score_details = EXCLUDED.ranking_score_details";

/// The two values the `compilation_outcome` enum accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompilationOutcome {
    /// `ok`: the compilation produced an executable.
    Ok,
    /// `fail`: the submission itself was rejected.
    Fail,
}

impl CompilationOutcome {
    /// The value the `compilation_outcome` column stores.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Fail => "fail",
        }
    }
}

/// The one value the `evaluation_outcome` enum accepts: it records that every
/// testcase of the dataset has an evaluation row, never how well it scored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvaluationOutcome {
    /// `ok`.
    Ok,
}

impl EvaluationOutcome {
    /// The value the `evaluation_outcome` column stores.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
        }
    }
}

/// The `submission_results` columns one object result writes: how far
/// compilation and evaluation have got, and what each of them cost.
#[derive(Debug, Clone, PartialEq)]
pub struct ResultRow {
    /// The row's own key, bound as `$1` and `$2`.
    pub key: ResultKey,
    /// `submission_results.compilation_outcome`, absent until compilation ends.
    pub compilation_outcome: Option<CompilationOutcome>,
    /// `submission_results.compilation_text`, the localized compiler output.
    pub compilation_text: Vec<String>,
    /// `submission_results.compilation_tries`, the failures so far.
    pub compilation_tries: i32,
    /// `submission_results.compilation_stdout`.
    pub compilation_stdout: Option<String>,
    /// `submission_results.compilation_stderr`.
    pub compilation_stderr: Option<String>,
    /// `submission_results.compilation_time`, in seconds.
    pub compilation_time: Option<f64>,
    /// `submission_results.compilation_wall_clock_time`, in seconds.
    pub compilation_wall_clock_time: Option<f64>,
    /// `submission_results.compilation_memory`, in bytes.
    pub compilation_memory: Option<i64>,
    /// `submission_results.compilation_shard`, the worker that compiled it.
    pub compilation_shard: Option<i32>,
    /// `submission_results.compilation_sandbox_paths`, absent when unset.
    pub compilation_sandbox_paths: Option<Vec<String>>,
    /// `submission_results.compilation_sandbox_digests`, absent when unset.
    pub compilation_sandbox_digests: Option<Vec<String>>,
    /// `submission_results.evaluation_outcome`, absent until every testcase ran.
    pub evaluation_outcome: Option<EvaluationOutcome>,
    /// `submission_results.evaluation_tries`, the failures so far.
    pub evaluation_tries: i32,
}

/// One file one compilation produced. `executables.id` is left out because the
/// column draws its own value, and the pair the unique constraint holds is
/// carried by the owning key and the filename.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableRow {
    /// The owning result's key, bound as `$1` and `$2`.
    pub key: ResultKey,
    /// `executables.filename`, unique within the owning result.
    pub filename: String,
    /// `executables.digest`, the identity of the stored file.
    pub digest: FileDigest,
}

/// One testcase run. `evaluations.id` is left out because the column draws its
/// own value, and the pair the unique constraint holds is carried by the owning
/// key and the testcase.
#[derive(Debug, Clone, PartialEq)]
pub struct EvaluationRow {
    /// The owning result's key, bound as `$1` and `$2`.
    pub key: ResultKey,
    /// `evaluations.testcase_id`, the testcase the run was performed on.
    pub testcase_id: i32,
    /// `evaluations.outcome`, the grader's own outcome string.
    pub outcome: Option<String>,
    /// `evaluations.text`, the localized grader output.
    pub text: Vec<String>,
    /// `evaluations.admin_text`, the admin-facing grader output.
    pub admin_text: Option<String>,
    /// `evaluations.execution_time`, in seconds.
    pub execution_time: Option<f64>,
    /// `evaluations.execution_wall_clock_time`, in seconds.
    pub execution_wall_clock_time: Option<f64>,
    /// `evaluations.execution_memory`, in bytes.
    pub execution_memory: Option<i64>,
    /// `evaluations.evaluation_shard`, the worker that ran it.
    pub evaluation_shard: Option<i32>,
    /// `evaluations.evaluation_sandbox_paths`, absent when unset.
    pub evaluation_sandbox_paths: Option<Vec<String>>,
    /// `evaluations.evaluation_sandbox_digests`, absent when unset.
    pub evaluation_sandbox_digests: Option<Vec<String>>,
}

/// The five score fields one scoring pass writes, plus the time it stamped them.
///
/// The two detail columns are `jsonb` and are carried as the text the statement
/// casts, so the score type's document reaches the column unaltered.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoreRow {
    /// The row's own key, bound as `$1` and `$2`.
    pub key: ResultKey,
    /// `submission_results.score`, what the dataset's score type computed.
    pub score: Option<f64>,
    /// `submission_results.score_details`, the `jsonb` document behind it.
    pub score_details: Option<String>,
    /// `submission_results.scored_at`, stamped the first time it is scored.
    pub scored_at: Option<NaiveDateTime>,
    /// `submission_results.public_score`, what a contestant is shown.
    pub public_score: Option<f64>,
    /// `submission_results.public_score_details`, the `jsonb` document behind it.
    pub public_score_details: Option<String>,
    /// `submission_results.ranking_score_details`, the one row shown in the RWS.
    pub ranking_score_details: Option<Vec<String>>,
}

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
