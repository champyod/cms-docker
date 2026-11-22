//! What a score type is handed, and what it hands back.
//!
//! The submission here is a value rather than a row: one flag saying whether the
//! submission was evaluated at all, the precision its task publishes at, and one entry
//! per testcase as its evaluation left it. A scoring pass builds it out of the result it
//! read; a score type never looks anything up, so every number it produces is decided by
//! what is in these structs.
//!
//! What comes back is the same shape the reference stores in `score_details` and
//! `public_score_details`: the score, the document behind it, the score a contestant who
//! played no token would see, the document behind that, and one string per subtask for
//! the ranking server. The two documents are typed rather than opaque JSON because the
//! panel that renders them reads them field by field, and a field that no longer exists
//! should fail to compile rather than render as a blank.
//!
//! A row a contestant may not see is a variant rather than a flag: the public document
//! holds a [`Row::Hidden`] where the private one holds the testcase's outcome, so a
//! hidden outcome cannot reach a contestant's page by a forgotten flag.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

/// One submission, as the score type is asked about it.
#[derive(Debug, Clone, PartialEq)]
pub struct Submission {
    /// Whether the submission was evaluated, which the reference reads as a non-null
    /// `evaluation_outcome`: a compilation that failed never got this far.
    pub evaluated: bool,
    /// `tasks.score_precision`, the decimal places a published score is rounded to.
    pub score_precision: u32,
    /// One entry per testcase of the dataset, in any order.
    pub testcases: Vec<Evaluated>,
}

/// One testcase of a submission, as its evaluation left it.
#[derive(Debug, Clone, PartialEq)]
pub struct Evaluated {
    /// `testcases.codename`, the name the parameters select this testcase by.
    pub codename: String,
    /// The outcome the run was judged with, which is the score before the subtask's weight.
    pub outcome: f64,
    /// What the report shows for the run: the sentence first, then its arguments.
    pub text: Vec<String>,
    /// The CPU time the run was charged, absent when none was measured.
    pub time: Option<f64>,
    /// `datasets.time_limit`, absent when the dataset sets none.
    pub time_limit: Option<f64>,
    /// The memory the run used, in bytes, absent when none was measured.
    pub memory: Option<i64>,
}

/// The testcases by codename, which is what the parameters select them by.
///
/// A codename that appears twice keeps the last evaluation, as the reference's dict does.
pub(crate) fn by_codename(testcases: &[Evaluated]) -> BTreeMap<&str, &Evaluated> {
    testcases
        .iter()
        .map(|evaluated| (evaluated.codename.as_str(), evaluated))
        .collect()
}

/// The three numbers a score type answers before any submission is scored.
#[derive(Debug, Clone, PartialEq)]
pub struct MaxScores {
    /// The most a submission can score.
    pub score: f64,
    /// The most a contestant who played no token can score, over the public testcases.
    pub public_score: f64,
    /// The ranking table's extra column headers, one per subtask.
    pub headers: Vec<String>,
}

/// One submission, scored.
#[derive(Debug, Clone, PartialEq)]
pub struct Scored {
    /// The score, before the task's precision is applied.
    pub score: f64,
    /// The document an administrator's page is rendered from.
    pub details: ScoreDetails,
    /// The score over the public testcases alone.
    pub public_score: f64,
    /// The document a contestant's page is rendered from.
    pub public_details: ScoreDetails,
    /// One string per subtask, as the ranking server reads the score.
    pub ranking_details: Vec<String>,
}

/// The document behind a score, whose shape is the score type's.
#[derive(Debug, Clone, PartialEq)]
pub enum ScoreDetails {
    /// One entry per subtask, as the group score types produce.
    Subtasks(Vec<Subtask>),
    /// One entry per testcase, as `Sum` produces: it has no subtasks to group.
    Testcases(Vec<SumRow>),
}

/// One subtask of a details document.
#[derive(Debug, Clone, PartialEq)]
pub enum Subtask {
    /// A subtask whose testcases were all readable, scored out of its weight.
    Scored {
        /// The position of the subtask in the parameters.
        index: usize,
        /// The fraction of the weight earned, kept so a zero-weight subtask still shows
        /// as correct rather than as undefined.
        score_fraction: f64,
        /// The weight earned, rounded to the task's precision for display.
        score: f64,
        /// The weight the subtask is worth.
        max_score: f64,
        /// The testcases the subtask selects.
        testcases: Vec<Row>,
    },
    /// A subtask in a contestant's document, whose weighting is not shown because some of
    /// its testcases are not public.
    Unscored {
        /// The position of the subtask in the parameters.
        index: usize,
        /// The public testcases of the subtask, and a hidden entry for each other one.
        testcases: Vec<Row>,
    },
}

/// One testcase row of a subtask document.
#[derive(Debug, Clone, PartialEq)]
pub enum Row {
    /// A testcase whose outcome this reader is shown.
    Shown(Testcase),
    /// A testcase whose outcome this reader is not shown at all.
    Hidden {
        /// The codename of the hidden testcase, which the row still numbers.
        index: String,
    },
}

/// One testcase of a subtask, as the panel renders it.
#[derive(Debug, Clone, PartialEq)]
pub struct Testcase {
    /// `testcases.codename`.
    pub index: String,
    /// The sentence a reader is shown for this testcase: `Correct`, `Not correct` or
    /// `Partially correct`, chosen by the score type.
    pub outcome: String,
    /// What the report holds, the sentence first and its arguments after.
    pub text: Vec<String>,
    /// The CPU time, absent when none was measured.
    pub time: Option<f64>,
    /// The dataset's time limit, absent when it sets none.
    pub time_limit: Option<f64>,
    /// Whether the run was stopped by the time limit, which the row shows as `>`.
    pub time_limit_was_exceeded: bool,
    /// The memory used, in bytes, absent when none was measured.
    pub memory: Option<i64>,
    /// Whether a contestant at `Restricted` is shown this testcase.
    pub show_in_restricted_feedback: bool,
    /// Whether a contestant at `OI Restricted` is shown this testcase.
    pub show_in_oi_restricted_feedback: bool,
}

/// One testcase row of a `Sum` document, which has no subtask to belong to.
#[derive(Debug, Clone, PartialEq)]
pub enum SumRow {
    /// A testcase whose outcome this reader is shown.
    Shown {
        /// `testcases.codename`.
        index: String,
        /// The sentence a reader is shown for this testcase.
        outcome: String,
        /// What the report holds, the sentence first and its arguments after.
        text: Vec<String>,
        /// The CPU time, absent when none was measured.
        time: Option<f64>,
        /// The memory used, in bytes, absent when none was measured.
        memory: Option<i64>,
    },
    /// A testcase whose outcome this reader is not shown at all.
    Hidden {
        /// The codename of the hidden testcase.
        index: String,
    },
}
