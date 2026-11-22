//! The criteria a submission search accepts and the pairs it refuses.
//!
//! A narrower criterion already names the rows a wider one would, so giving both is
//! refused rather than run twice; the reference raises `ValueError` for the same pairs.

use sqlx::Error;

use crate::reads::{DatasetId, SubmissionId};

/// The criteria one submission search filters on; every field is optional.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SubmissionFilter {
    /// `submissions.id`.
    pub submission_id: Option<SubmissionId>,
    /// `participations.id` the submission was sent by.
    pub participation_id: Option<i32>,
    /// `submissions.task_id`.
    pub task_id: Option<i32>,
    /// `participations.contest_id`.
    pub contest_id: Option<i32>,
}

/// The criteria one submission-result search filters on; every field is optional.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ResultFilter {
    /// `submission_results.submission_id`.
    pub submission_id: Option<SubmissionId>,
    /// `participations.id` the submission was sent by.
    pub participation_id: Option<i32>,
    /// `submissions.task_id`.
    pub task_id: Option<i32>,
    /// `participations.contest_id`.
    pub contest_id: Option<i32>,
    /// `submission_results.dataset_id`.
    pub dataset_id: Option<DatasetId>,
}

impl SubmissionFilter {
    /// Refuse a pair of criteria where one already implies the other.
    ///
    /// # Errors
    ///
    /// Returns [`SearchError::Superfluous`] naming the wider criterion and the one
    /// that implies it.
    pub fn validate(&self) -> Result<(), SearchError> {
        check_common(
            self.submission_id,
            self.participation_id,
            self.task_id,
            self.contest_id,
        )
    }
}

impl ResultFilter {
    /// Refuse a pair of criteria where one already implies the other.
    ///
    /// # Errors
    ///
    /// Returns [`SearchError::Superfluous`] naming the wider criterion and the one
    /// that implies it; a dataset also implies the task and the contest it belongs to.
    pub fn validate(&self) -> Result<(), SearchError> {
        check_common(
            self.submission_id,
            self.participation_id,
            self.task_id,
            self.contest_id,
        )?;
        if self.dataset_id.is_some() && self.task_id.is_some() {
            return Err(SearchError::Superfluous {
                field: "task_id",
                implied_by: "dataset_id",
            });
        }
        if self.dataset_id.is_some() && self.contest_id.is_some() {
            return Err(SearchError::Superfluous {
                field: "contest_id",
                implied_by: "dataset_id",
            });
        }
        Ok(())
    }
}

/// The five refusals both searches share, in the order the reference checks them.
fn check_common(
    submission_id: Option<SubmissionId>,
    participation_id: Option<i32>,
    task_id: Option<i32>,
    contest_id: Option<i32>,
) -> Result<(), SearchError> {
    let pairs = [
        (
            task_id.is_some() && contest_id.is_some(),
            "contest_id",
            "task_id",
        ),
        (
            participation_id.is_some() && contest_id.is_some(),
            "contest_id",
            "participation_id",
        ),
        (
            submission_id.is_some() && contest_id.is_some(),
            "contest_id",
            "submission_id",
        ),
        (
            submission_id.is_some() && task_id.is_some(),
            "task_id",
            "submission_id",
        ),
        (
            submission_id.is_some() && participation_id.is_some(),
            "participation_id",
            "submission_id",
        ),
    ];
    for (refused, field, implied_by) in pairs {
        if refused {
            return Err(SearchError::Superfluous { field, implied_by });
        }
    }
    Ok(())
}

/// Why a search was refused.
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    /// One criterion already names every row the other would admit.
    #[error("{field} is superfluous if {implied_by} is given")]
    Superfluous {
        /// The wider criterion the caller also gave.
        field: &'static str,
        /// The narrower criterion that implies it.
        implied_by: &'static str,
    },
    /// A statement the driver refused.
    #[error(transparent)]
    Database(#[from] Error),
}
