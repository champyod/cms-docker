//! The score types whose testcases are grouped into subtasks.
//!
//! `GroupMin`, `GroupMul` and `GroupThreshold` score a subtask by the same algorithm: each
//! testcase's outcome is read, the subtask's fraction is the reduction of those outcomes,
//! and the subtask is worth that fraction of its weight. What differs is one line — the
//! reduction — which is [`crate::scoretypes::reduce`]'s whole business, and the sentence a
//! testcase is shown with.
//!
//! The reduction is a match over [`Reduction`] rather than a method three types implement,
//! because a score type is chosen by the name in a dataset's `score_type` column: the set
//! is closed and lives in this crate, so the match is where a fourth one is added and the
//! compiler names every place that has to change. This module is the shape the three share:
//! the weights, the scores they add up to, and the loop over the subtasks. What one subtask
//! is worth is [`crate::scoretypes::subtask`], and what a subtask's testcases are selected
//! by is [`crate::scoretypes::params`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use serde_json::Value;

use super::error::ScoreTypeError;
use super::format::format_general;
use super::params::{group_parameters, GroupParameter};
use super::submission::{by_codename, MaxScores, ScoreDetails, Scored, Submission};
use super::Reduction;

/// A score type whose testcases are grouped into subtasks.
#[derive(Debug, Clone, PartialEq)]
pub struct Group {
    pub(super) reduction: Reduction,
    pub(super) parameters: Vec<GroupParameter>,
    pub(super) public_testcases: BTreeMap<String, bool>,
}

impl Group {
    /// The group score type of `reduction`, over the given parameters.
    ///
    /// # Errors
    ///
    /// Returns [`ScoreTypeError`] for parameters that are not entries of the shape this
    /// reduction takes, for subtasks that select in two ways, and for one that selects no
    /// testcase: a subtask nothing is in is a dataset mistake, not a score.
    pub fn new(
        reduction: Reduction,
        parameters: &Value,
        public_testcases: BTreeMap<String, bool>,
    ) -> Result<Self, ScoreTypeError> {
        let thresholded = reduction == Reduction::Threshold;
        let resolved =
            group_parameters(parameters, &public_testcases, thresholded, reduction.name())?;
        Ok(Self {
            reduction,
            parameters: resolved,
            public_testcases,
        })
    }

    /// The most a submission can score, and the headers a ranking table shows.
    #[must_use]
    pub fn max_scores(&self) -> MaxScores {
        let mut score = 0.0;
        let mut public_score = 0.0;
        let mut headers = Vec::with_capacity(self.parameters.len());
        for (index, parameter) in self.parameters.iter().enumerate() {
            score += parameter.max_score;
            if self.is_public(parameter) {
                public_score += parameter.max_score;
            }
            headers.push(format!(
                "Subtask {index} ({})",
                format_general(parameter.max_score)
            ));
        }
        MaxScores {
            score,
            public_score,
            headers,
        }
    }

    /// One submission, scored.
    ///
    /// # Errors
    ///
    /// Returns [`ScoreTypeError::MissingEvaluation`] for a testcase the parameters select
    /// and the result does not hold, which would otherwise score as a number nobody read.
    pub fn compute_score(&self, submission: &Submission) -> Result<Scored, ScoreTypeError> {
        if !submission.evaluated {
            return Ok(Scored {
                score: 0.0,
                details: ScoreDetails::Subtasks(Vec::new()),
                public_score: 0.0,
                public_details: ScoreDetails::Subtasks(Vec::new()),
                // One zero per subtask, so the ranking table's columns stay aligned.
                ranking_details: vec!["0".to_owned(); self.parameters.len()],
            });
        }
        let evaluations = by_codename(&submission.testcases);
        let precision = submission.score_precision;
        let mut score = 0.0;
        let mut public_score = 0.0;
        let mut subtasks = Vec::with_capacity(self.parameters.len());
        let mut public_subtasks = Vec::with_capacity(self.parameters.len());
        let mut ranking_details = Vec::with_capacity(self.parameters.len());
        for (index, parameter) in self.parameters.iter().enumerate() {
            let detail = self.subtask_of(index, parameter, &evaluations, precision)?;
            score += detail.score;
            if self.is_public(parameter) {
                public_score += detail.score;
            }
            ranking_details.push(format_general(detail.score));
            subtasks.push(detail.subtask);
            public_subtasks.push(detail.public_subtask);
        }
        Ok(Scored {
            score,
            details: ScoreDetails::Subtasks(subtasks),
            public_score,
            public_details: ScoreDetails::Subtasks(public_subtasks),
            ranking_details,
        })
    }

    /// Whether every testcase of the subtask is public.
    pub(super) fn is_public(&self, parameter: &GroupParameter) -> bool {
        parameter
            .targets
            .iter()
            .all(|codename| self.publicity(codename))
    }

    /// Whether one testcase is public: the flag the dataset set for it.
    pub(super) fn publicity(&self, codename: &str) -> bool {
        self.public_testcases
            .get(codename)
            .copied()
            .unwrap_or(false)
    }
}
