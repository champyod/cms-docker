//! The row each table of a judging commit is written as.
//!
//! Every field is one column, in the order its statement binds it, and every
//! column the statement names has a field here: a value the column would have
//! refused never reaches a query. The two enum columns are typed rather than
//! spelled as text, so `compilation_outcome` and `evaluation_outcome` accept
//! only the values their enum declares, and `executables.digest` is the same
//! [`FileDigest`] the read side already applies the `DIGEST` domain to.
//!
//! The autoincrement `id` of `executables` and `evaluations` is absent, because
//! the column draws its own value, and the pair each unique constraint holds is
//! carried by the owning [`ResultKey`] plus the filename or the testcase.

use chrono::NaiveDateTime;

use crate::digest::FileDigest;
use crate::reads::ResultKey;

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
