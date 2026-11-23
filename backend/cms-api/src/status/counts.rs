//! The seven buckets, and the reconciliation that reports a submission no bucket classified.
//!
//! The five flag rules are `cms_db::SubmissionResult`'s own, so only the bucket split is decided here.

use cms_db::SubmissionResult;
use cms_grading::limits::{MAX_COMPILATION_TRIES, MAX_EVALUATION_TRIES};

/// Submissions per status, plus the total a gauge reports beside them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StatusCounts {
    /// Not compiled yet, or in no status at all: the reconciliation adds the unclassified here.
    pub compiling: i64,
    /// Not compiled, and the compilation attempts are spent.
    pub max_compilations: i64,
    /// `compilation_outcome = 'fail'`, so the submission itself was rejected.
    pub compilation_fail: i64,
    /// Compiled, not evaluated, and the evaluation attempts are not spent.
    pub evaluating: i64,
    /// Compiled, not evaluated, and the evaluation attempts are spent.
    pub max_evaluations: i64,
    /// Evaluated, and the five score columns are not all filled.
    pub scoring: i64,
    /// Evaluated, and all five score columns are filled.
    pub scored: i64,
    /// Every submission in scope, whether or not its active dataset has a result row.
    pub total: i64,
}

/// The reference's buckets over the rows read, then its reconciliation of what they left out.
pub(super) fn count(results: &[Option<SubmissionResult>]) -> StatusCounts {
    let mut counts = StatusCounts {
        total: results.len() as i64,
        ..StatusCounts::default()
    };
    for result in results.iter().flatten() {
        counts.add(result);
    }
    counts.reconcile();
    counts
}

impl StatusCounts {
    /// Counts one result in the bucket the reference counts it in, in the reference's order.
    fn add(&mut self, result: &SubmissionResult) {
        if !result.compiled() {
            if result.compilation_tries < MAX_COMPILATION_TRIES {
                self.compiling += 1;
            } else {
                self.max_compilations += 1;
            }
        } else if result.compilation_failed() {
            self.compilation_fail += 1;
        } else if result.compilation_succeeded() {
            if !result.evaluated() {
                if result.evaluation_tries < MAX_EVALUATION_TRIES {
                    self.evaluating += 1;
                } else {
                    self.max_evaluations += 1;
                }
            } else if result.scored() {
                self.scored += 1;
            } else {
                self.scoring += 1;
            }
        }
        // A compiled outcome that is neither `ok` nor `fail` fits no bucket here, as in the reference.
    }

    /// Reports every submission no bucket classified as compiling, where a dashboard can see it.
    fn reconcile(&mut self) {
        // WHY the sum includes `compiling` and `total`: the reference adds `2*total - sum(stats)`, where its own
        // `compiling` cancels out and leaves total minus every other bucket — the unclassified included.
        let sum = self.total
            + self.compiling
            + self.max_compilations
            + self.compilation_fail
            + self.evaluating
            + self.max_evaluations
            + self.scoring
            + self.scored;
        self.compiling += 2 * self.total - sum;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cms_db::{CompilationOutcome, DatasetId, EvaluationOutcome, SubmissionId};

    /// A result whose compilation ended, with `tries` failures behind it.
    fn compiled(succeeded: bool, tries: i32) -> SubmissionResult {
        let mut result = SubmissionResult::new(SubmissionId(1), DatasetId(1));
        result.compilation_outcome = Some(if succeeded {
            CompilationOutcome::Ok
        } else {
            CompilationOutcome::Fail
        });
        result.compilation_tries = tries;
        result
    }

    /// A compiled result whose evaluation ended, with `tries` failures behind it.
    fn evaluated(tries: i32) -> SubmissionResult {
        let mut result = compiled(true, 0);
        result.evaluation_outcome = Some(EvaluationOutcome::Ok);
        result.evaluation_tries = tries;
        result
    }

    /// An evaluated result holding all five score columns.
    fn scored() -> SubmissionResult {
        let mut result = evaluated(0);
        result.score = Some(1.0);
        result.score_details = Some("{}".to_owned());
        result.public_score = Some(1.0);
        result.public_score_details = Some("{}".to_owned());
        result.ranking_score_details = Some(vec!["1".to_owned()]);
        result
    }

    #[test]
    fn the_reconciliation_reports_unclassified_submissions_as_compiling() {
        let rows = vec![
            Some(SubmissionResult::new(SubmissionId(1), DatasetId(1))),
            Some(SubmissionResult::new(SubmissionId(2), DatasetId(1))),
            Some(compiled(false, 1)),
            Some(compiled(true, 0)),
            Some(compiled(true, 0)),
            Some(compiled(true, 0)),
            Some(evaluated(0)),
            Some(scored()),
            None,
            None,
        ];
        assert_eq!(
            count(&rows),
            StatusCounts {
                compiling: 4,
                max_compilations: 0,
                compilation_fail: 1,
                evaluating: 3,
                max_evaluations: 0,
                scoring: 1,
                scored: 1,
                total: 10,
            },
            "two submissions no bucket classified must be reported, not dropped"
        );
    }

    #[test]
    fn the_attempt_caps_decide_the_exhausted_buckets() {
        let mut compiling = SubmissionResult::new(SubmissionId(1), DatasetId(1));
        compiling.compilation_tries = MAX_COMPILATION_TRIES - 1;
        let mut exhausted = SubmissionResult::new(SubmissionId(2), DatasetId(1));
        exhausted.compilation_tries = MAX_COMPILATION_TRIES;
        let mut evaluating = compiled(true, 0);
        evaluating.evaluation_tries = MAX_EVALUATION_TRIES - 1;
        let mut max_evaluations = compiled(true, 0);
        max_evaluations.evaluation_tries = MAX_EVALUATION_TRIES;

        let counts = count(&[
            Some(compiling),
            Some(exhausted),
            Some(evaluating),
            Some(max_evaluations),
        ]);
        assert_eq!(
            (
                counts.compiling,
                counts.max_compilations,
                counts.evaluating,
                counts.max_evaluations
            ),
            (1, 1, 1, 1),
            "the last allowed attempt and the first spent one must land in different buckets"
        );
    }
}
