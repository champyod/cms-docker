//! How far a result has got, and the transitions that move it: `submission.py:436-639`.

use sqlx::postgres::PgConnection;

use super::{SubmissionError, SubmissionResult};
use crate::reads::{DatasetId, SubmissionId};
use crate::writes::{CompilationOutcome, EvaluationOutcome};

/// Where a result has got to (`submission.py:290-294`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmissionStatus {
    /// `COMPILING`: no compilation outcome is recorded, and a missing row reads as this.
    Compiling,
    /// `COMPILATION_FAILED`: the submission itself was rejected.
    CompilationFailed,
    /// `EVALUATING`: it compiled, and the testcases have not all run.
    Evaluating,
    /// `SCORING`: every testcase ran, and the score is not written yet.
    Scoring,
    /// `SCORED`: all five score fields hold a value.
    Scored,
}

impl SubmissionResult {
    /// A result nothing has been written to, which reads as [`SubmissionStatus::Compiling`].
    #[must_use]
    pub const fn new(submission_id: SubmissionId, dataset_id: DatasetId) -> Self {
        Self {
            submission_id,
            dataset_id,
            compilation_outcome: None,
            compilation_tries: 0,
            evaluation_outcome: None,
            evaluation_tries: 0,
            score: None,
            score_details: None,
            public_score: None,
            public_score_details: None,
            ranking_score_details: None,
        }
    }

    /// The status this row's flags spell, in the reference's order (`submission.py:436-449`), which reports a rejection before a score.
    #[must_use]
    pub fn status(&self) -> SubmissionStatus {
        if !self.compiled() {
            SubmissionStatus::Compiling
        } else if self.compilation_failed() {
            SubmissionStatus::CompilationFailed
        } else if !self.evaluated() {
            SubmissionStatus::Evaluating
        } else if !self.scored() {
            SubmissionStatus::Scoring
        } else {
            SubmissionStatus::Scored
        }
    }

    /// Whether an outcome is recorded at all, which is what `compiled()` reads.
    #[must_use]
    pub const fn compiled(&self) -> bool {
        self.compilation_outcome.is_some()
    }

    /// Whether that outcome is `fail`, which is a rejection of the submission itself.
    #[must_use]
    pub fn compilation_failed(&self) -> bool {
        self.compilation_outcome == Some(CompilationOutcome::Fail)
    }

    /// Whether that outcome is `ok`, which is what an executable exists for.
    #[must_use]
    pub fn compilation_succeeded(&self) -> bool {
        self.compilation_outcome == Some(CompilationOutcome::Ok)
    }

    /// Whether an evaluation outcome is recorded, which is what `evaluations != []` means.
    #[must_use]
    pub const fn evaluated(&self) -> bool {
        self.evaluation_outcome.is_some()
    }

    /// Whether all five score fields hold a value (`submission.py:565-574`).
    #[must_use]
    pub fn scored(&self) -> bool {
        self.score.is_some()
            && self.score_details.is_some()
            && self.public_score.is_some()
            && self.public_score_details.is_some()
            && self.ranking_score_details.is_some()
    }

    /// Whether a scoring pass is owed: compiled away or fully evaluated, and unscored.
    #[must_use]
    pub fn needs_scoring(&self) -> bool {
        (self.compilation_failed() || self.evaluated()) && !self.scored()
    }

    /// Records the compilation outcome the sandbox reported.
    pub fn set_compilation_outcome(&mut self, success: bool) {
        self.compilation_outcome = Some(if success {
            CompilationOutcome::Ok
        } else {
            CompilationOutcome::Fail
        });
    }

    /// Records that every testcase of the dataset ran.
    pub fn set_evaluation_outcome(&mut self) {
        self.evaluation_outcome = Some(EvaluationOutcome::Ok);
    }

    /// Clears the score, which every other invalidation does first.
    pub fn clear_score(&mut self) {
        self.score = None;
        self.score_details = None;
        self.public_score = None;
        self.public_score_details = None;
        self.ranking_score_details = None;
    }

    /// Clears the evaluation fields and the score that reads them: the outcome describes the whole set (`submission.py:609-615`).
    pub fn clear_evaluation(&mut self) {
        self.clear_score();
        self.evaluation_outcome = None;
        self.evaluation_tries = 0;
    }

    /// Clears compilation and, first, everything compiled output fed.
    pub fn clear_compilation(&mut self) {
        self.clear_evaluation();
        self.compilation_outcome = None;
        self.compilation_tries = 0;
    }

    /// Removes the evaluation rows and clears the fields that described them.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a delete the driver refused.
    pub async fn invalidate_evaluation(
        &mut self,
        connection: &mut PgConnection,
        testcase: Option<i32>,
    ) -> Result<(), SubmissionError> {
        sqlx::query(super::evaluation::DELETE_EVALUATIONS)
            .bind(self.submission_id.0)
            .bind(self.dataset_id.0)
            .bind(testcase)
            .execute(&mut *connection)
            .await?;
        self.clear_evaluation();
        Ok(())
    }

    /// Removes the executable and evaluation rows, then clears the fields describing them.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a delete the driver refused.
    pub async fn invalidate_compilation(
        &mut self,
        connection: &mut PgConnection,
    ) -> Result<(), SubmissionError> {
        sqlx::query(super::evaluation::DELETE_EXECUTABLES)
            .bind(self.submission_id.0)
            .bind(self.dataset_id.0)
            .execute(&mut *connection)
            .await?;
        self.invalidate_evaluation(connection, None).await?;
        self.compilation_outcome = None;
        self.compilation_tries = 0;
        Ok(())
    }
}
