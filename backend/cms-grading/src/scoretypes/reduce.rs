//! The one line that tells the three subtask score types apart.
//!
//! A subtask's outcomes are reduced to a fraction: the smallest of them, their product, or
//! one where every outcome is above zero and at most the subtask's threshold. The same match
//! answers the sentence each testcase is shown with, because the two questions are the same
//! question — what this subtask's outcomes are worth — asked of the whole subtask and of one
//! testcase of it.
//!
//! The match has no wildcard arm. A fourth reduction is added here, and the compiler then
//! names both halves of it, which is what a closed set chosen by a database column should
//! cost.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use super::params::GroupParameter;
use super::submission::Evaluated;
use super::Group;

/// What a subtask's outcomes are reduced to one fraction with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reduction {
    /// The smallest outcome, so one wrong testcase costs the whole subtask.
    Min,
    /// The product, so every testcase has to be right.
    Mul,
    /// Full weight where every outcome is above zero and at most the threshold.
    Threshold,
}

impl Reduction {
    /// The name the `score_type` column holds.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Min => "GroupMin",
            Self::Mul => "GroupMul",
            Self::Threshold => "GroupThreshold",
        }
    }
}

impl Group {
    /// The subtask's fraction.
    pub(super) fn reduce(
        &self,
        parameter: &GroupParameter,
        evaluations: &BTreeMap<&str, &Evaluated>,
    ) -> f64 {
        let outcomes: Vec<f64> = parameter
            .targets
            .iter()
            .map(|codename| evaluations[codename.as_str()].outcome)
            .collect();
        match self.reduction {
            Reduction::Min => outcomes.iter().copied().fold(f64::INFINITY, f64::min),
            Reduction::Mul => outcomes.iter().product(),
            Reduction::Threshold => {
                let threshold = parameter.threshold.unwrap_or_default();
                // Zero is a run that never answered, so a threshold must not count it.
                if outcomes
                    .iter()
                    .all(|outcome| 0.0 < *outcome && *outcome <= threshold)
                {
                    1.0
                } else {
                    0.0
                }
            }
        }
    }

    /// The sentence a testcase of this subtask is shown with.
    pub(super) fn public_outcome(&self, outcome: f64, parameter: &GroupParameter) -> String {
        match self.reduction {
            Reduction::Min | Reduction::Mul => public_outcome_of_fraction(outcome),
            Reduction::Threshold => {
                let threshold = parameter.threshold.unwrap_or_default();
                if 0.0 < outcome && outcome <= threshold {
                    "Correct"
                } else {
                    "Not correct"
                }
                .to_owned()
            }
        }
    }
}

/// The sentence a fraction of a subtask is shown with, where one means correct.
fn public_outcome_of_fraction(outcome: f64) -> String {
    if outcome <= 0.0 {
        "Not correct"
    } else if outcome >= 1.0 {
        "Correct"
    } else {
        "Partially correct"
    }
    .to_owned()
}
