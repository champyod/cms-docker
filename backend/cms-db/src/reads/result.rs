//! One `submission_results` row: the columns that read it, and the record they
//! map onto.

/// The composite primary key of `submission_results`, in the order its query
/// binds it: `submission_id` as `$1`, `dataset_id` as `$2`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultKey {
    /// `submission_results.submission_id`.
    pub submission_id: i32,
    /// `submission_results.dataset_id`.
    pub dataset_id: i32,
}

/// The columns one `submission_results` row is read with, bound to its key.
pub const RESULT_BY_SUBMISSION_AND_DATASET: &str = "\
    SELECT r.submission_id, r.dataset_id,
           r.compilation_outcome IS NOT NULL AS is_compiled,
           r.compilation_outcome = 'ok' AS is_compilation_succeeded,
           r.compilation_tries,
           r.evaluation_outcome IS NOT NULL AS is_evaluated,
           r.evaluation_tries
    FROM submission_results AS r
    WHERE r.submission_id = $1 AND r.dataset_id = $2";

/// One result: how far compilation and evaluation have got, and what they cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultRecord {
    /// `submission_results.submission_id`.
    pub submission_id: i32,
    /// `submission_results.dataset_id`, the dataset the result belongs to.
    pub dataset_id: i32,
    /// `SubmissionResult.compiled()`: an outcome is recorded at all.
    pub is_compiled: bool,
    /// `SubmissionResult.compilation_succeeded()`: that outcome is `ok`.
    pub is_compilation_succeeded: bool,
    /// `submission_results.compilation_tries`, the failures so far.
    pub compilation_tries: i32,
    /// `SubmissionResult.evaluated()`: an outcome is recorded at all.
    pub is_evaluated: bool,
    /// `submission_results.evaluation_tries`, the failures so far.
    pub evaluation_tries: i32,
}

/// Maps the columns [`RESULT_BY_SUBMISSION_AND_DATASET`] names onto the record.
#[must_use]
pub const fn result_from_row(
    key: ResultKey,
    is_compiled: bool,
    is_compilation_succeeded: bool,
    compilation_tries: i32,
    is_evaluated: bool,
    evaluation_tries: i32,
) -> ResultRecord {
    ResultRecord {
        submission_id: key.submission_id,
        dataset_id: key.dataset_id,
        is_compiled,
        is_compilation_succeeded,
        compilation_tries,
        is_evaluated,
        evaluation_tries,
    }
}
