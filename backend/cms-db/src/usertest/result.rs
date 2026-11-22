//! One `user_test_results` row, keyed by the test and the dataset.
//!
//! `src/cms/db/usertest.py:224-495` holds the row and the status the evaluation
//! service reads from it. The status is derived, never stored: a row with no
//! compilation outcome is compiling, a failed compilation is final, a compiled
//! row without an evaluation outcome is evaluating, and only an evaluation
//! outcome ends it.
//!
//! [`ResultKey`] exists because both key columns are `integer` and every
//! executable names the same pair as a composite foreign key, so a bare pair of
//! `i32` could be swapped.

use std::collections::BTreeMap;

use crate::digest::FileDigest;
use crate::writes::{CompilationOutcome, EvaluationOutcome};

use super::model::UserTestExecutable;

/// The composite key `(user_test_id, dataset_id)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ResultKey {
    /// `user_test_results.user_test_id`.
    pub user_test_id: i32,
    /// `user_test_results.dataset_id`.
    pub dataset_id: i32,
}

impl ResultKey {
    /// The key of a result row.
    #[must_use]
    pub const fn new(user_test_id: i32, dataset_id: i32) -> Self {
        Self {
            user_test_id,
            dataset_id,
        }
    }
}

/// The four values `get_status` answers, numbered as the reference numbers them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(i32)]
pub enum UserTestStatus {
    /// The compilation has not finished.
    Compiling = 1,
    /// The compilation ended with `fail`.
    CompilationFailed = 2,
    /// The compilation succeeded and the evaluation has not finished.
    Evaluating = 3,
    /// The evaluation has an outcome.
    Evaluated = 4,
}

impl UserTestStatus {
    /// The integer `UserTestResult.get_status` returns.
    #[must_use]
    pub const fn code(self) -> i32 {
        self as i32
    }
}

/// A row of `user_test_results`.
#[derive(Debug, Clone, PartialEq)]
pub struct UserTestResult {
    /// `user_test_results.user_test_id`.
    pub user_test_id: i32,
    /// `user_test_results.dataset_id`.
    pub dataset_id: i32,
    /// `user_test_results.output`, the digest the evaluation wrote.
    pub output: Option<FileDigest>,
    /// `user_test_results.compilation_outcome`, absent until compilation ends.
    pub compilation_outcome: Option<CompilationOutcome>,
    /// `user_test_results.compilation_text`, the localized compiler output.
    pub compilation_text: Vec<String>,
    /// `user_test_results.compilation_tries`.
    pub compilation_tries: i32,
    /// `user_test_results.compilation_stdout`.
    pub compilation_stdout: Option<String>,
    /// `user_test_results.compilation_stderr`.
    pub compilation_stderr: Option<String>,
    /// `user_test_results.compilation_time`, in seconds.
    pub compilation_time: Option<f64>,
    /// `user_test_results.compilation_wall_clock_time`, in seconds.
    pub compilation_wall_clock_time: Option<f64>,
    /// `user_test_results.compilation_memory`, in bytes.
    pub compilation_memory: Option<i64>,
    /// `user_test_results.compilation_shard`, the worker that compiled it.
    pub compilation_shard: Option<i32>,
    /// `user_test_results.compilation_sandbox_paths`.
    pub compilation_sandbox_paths: Option<Vec<String>>,
    /// `user_test_results.compilation_sandbox_digests`.
    pub compilation_sandbox_digests: Option<Vec<String>>,
    /// `user_test_results.evaluation_outcome`, absent until evaluation ends.
    pub evaluation_outcome: Option<EvaluationOutcome>,
    /// `user_test_results.evaluation_text`, the localized grader output.
    pub evaluation_text: Vec<String>,
    /// `user_test_results.evaluation_tries`.
    pub evaluation_tries: i32,
    /// `user_test_results.execution_time`, in seconds.
    pub execution_time: Option<f64>,
    /// `user_test_results.execution_wall_clock_time`, in seconds.
    pub execution_wall_clock_time: Option<f64>,
    /// `user_test_results.execution_memory`, in bytes.
    pub execution_memory: Option<i64>,
    /// `user_test_results.evaluation_shard`, the worker that evaluated it.
    pub evaluation_shard: Option<i32>,
    /// `user_test_results.evaluation_sandbox_paths`.
    pub evaluation_sandbox_paths: Option<Vec<String>>,
    /// `user_test_results.evaluation_sandbox_digests`.
    pub evaluation_sandbox_digests: Option<Vec<String>>,
    executables: BTreeMap<String, UserTestExecutable>,
}

impl UserTestResult {
    /// The row as it stands before compilation: absent outcomes, empty texts and
    /// zero tries, which are the columns' own defaults.
    #[must_use]
    pub fn new(user_test_id: i32, dataset_id: i32) -> Self {
        Self {
            user_test_id,
            dataset_id,
            output: None,
            compilation_outcome: None,
            compilation_text: Vec::new(),
            compilation_tries: 0,
            compilation_stdout: None,
            compilation_stderr: None,
            compilation_time: None,
            compilation_wall_clock_time: None,
            compilation_memory: None,
            compilation_shard: None,
            compilation_sandbox_paths: None,
            compilation_sandbox_digests: None,
            evaluation_outcome: None,
            evaluation_text: Vec::new(),
            evaluation_tries: 0,
            execution_time: None,
            execution_wall_clock_time: None,
            execution_memory: None,
            evaluation_shard: None,
            evaluation_sandbox_paths: None,
            evaluation_sandbox_digests: None,
            executables: BTreeMap::new(),
        }
    }

    /// The key this row is filed under.
    #[must_use]
    pub const fn key(&self) -> ResultKey {
        ResultKey::new(self.user_test_id, self.dataset_id)
    }

    /// The status `get_status` derives.
    #[must_use]
    pub fn status(&self) -> UserTestStatus {
        if !self.compiled() {
            UserTestStatus::Compiling
        } else if self.compilation_failed() {
            UserTestStatus::CompilationFailed
        } else if !self.evaluated() {
            UserTestStatus::Evaluating
        } else {
            UserTestStatus::Evaluated
        }
    }

    /// Whether the compilation produced an outcome, either way.
    #[must_use]
    pub fn compiled(&self) -> bool {
        self.compilation_outcome.is_some()
    }

    /// Whether the compilation ended with `fail`.
    #[must_use]
    pub fn compilation_failed(&self) -> bool {
        self.compilation_outcome == Some(CompilationOutcome::Fail)
    }

    /// Whether the compilation ended with `ok`.
    #[must_use]
    pub fn compilation_succeeded(&self) -> bool {
        self.compilation_outcome == Some(CompilationOutcome::Ok)
    }

    /// Whether the evaluation produced an outcome.
    #[must_use]
    pub fn evaluated(&self) -> bool {
        self.evaluation_outcome.is_some()
    }

    /// One executable by filename, or nothing when it was never produced.
    #[must_use]
    pub fn executable(&self, filename: &str) -> Option<&UserTestExecutable> {
        self.executables.get(filename)
    }

    /// Every executable this result owns, in filename order.
    pub fn executables(&self) -> impl Iterator<Item = &UserTestExecutable> {
        self.executables.values()
    }

    /// Record the compilation outcome as the boolean the evaluator reports.
    pub fn set_compilation_outcome(&mut self, success: bool) {
        self.compilation_outcome = Some(if success {
            CompilationOutcome::Ok
        } else {
            CompilationOutcome::Fail
        });
    }

    /// Record that the evaluation ended; the reference has one outcome, `ok`.
    pub fn set_evaluation_outcome(&mut self) {
        self.evaluation_outcome = Some(EvaluationOutcome::Ok);
    }

    /// Blank every compilation and evaluation outcome, and the executables.
    ///
    /// The reference also assigned `compilation_sandbox`, an attribute the model
    /// does not declare; the paths and digests behind that name are what exist to
    /// clear, so they are cleared here.
    pub fn invalidate_compilation(&mut self) {
        self.invalidate_evaluation();
        self.compilation_outcome = None;
        self.compilation_text.clear();
        self.compilation_tries = 0;
        self.compilation_stdout = None;
        self.compilation_stderr = None;
        self.compilation_time = None;
        self.compilation_wall_clock_time = None;
        self.compilation_memory = None;
        self.compilation_shard = None;
        self.compilation_sandbox_paths = None;
        self.compilation_sandbox_digests = None;
        self.executables.clear();
    }

    /// Blank the evaluation and the output, leaving the compilation intact.
    pub fn invalidate_evaluation(&mut self) {
        self.evaluation_outcome = None;
        self.evaluation_text.clear();
        self.evaluation_tries = 0;
        self.execution_time = None;
        self.execution_wall_clock_time = None;
        self.execution_memory = None;
        self.evaluation_shard = None;
        self.evaluation_sandbox_paths = None;
        self.evaluation_sandbox_digests = None;
        self.output = None;
    }
}
