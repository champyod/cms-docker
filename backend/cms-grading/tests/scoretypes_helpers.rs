//! The dataset and the submissions the score type tests are decided by.
//!
//! The seven testcases, their publicity and the figures every testcase carries are the
//! reference's own: its score type tests build the same dataset, so every number these
//! tests expect is one the reference implementation produces rather than one this port
//! chose. The evaluations are handed over in reverse codename order, as the reference's
//! tests hand them over, so a score that depended on the order they arrive in would fail
//! here rather than pass by luck.

#![allow(dead_code)]

use std::collections::BTreeMap;

use cms_grading::scoretypes::{
    Evaluated, Row, ScoreDetails, ScoreType, Submission, Subtask, SumRow,
};
use serde_json::{json, Value};

/// The seven testcases: four public, and the last three not.
pub fn public_testcases() -> BTreeMap<String, bool> {
    [
        ("0_0", true),
        ("1_0", true),
        ("1_1", true),
        ("2_0", true),
        ("2_1", false),
        ("3_0", false),
        ("3_1", false),
    ]
    .into_iter()
    .map(|(codename, public)| (codename.to_owned(), public))
    .collect()
}

/// The three subtasks `GroupMin` and `GroupMul` are tested with, named by pattern.
pub fn groups() -> Value {
    json!([[10.5, "0_*"], [30.5, "1_*"], [59, "2_*"]])
}

/// The same three subtasks, named by count, which consume the codenames in order.
pub fn counted_groups() -> Value {
    json!([[10.5, 1], [30.5, 2], [59, 2]])
}

/// The four subtasks `GroupThreshold` is tested with, each with its threshold.
pub fn thresholds() -> Value {
    json!([
        [0, "0_*", 0],
        [10.5, "1_*", 10],
        [30.5, "2_*", 20],
        [59, "3_*", 30]
    ])
}

/// The score type of that name over the seven testcases.
pub fn score_type(name: &str, parameters: Value) -> ScoreType {
    ScoreType::of(name, &parameters, public_testcases())
        .expect("the seven testcases hold what the parameters select")
}

/// One evaluated testcase, with the figures the reference's tests give every testcase:
/// half a second, a hundred bytes, and a one-second limit.
pub fn evaluated(codename: &str, outcome: f64) -> Evaluated {
    Evaluated {
        codename: codename.to_owned(),
        outcome,
        text: vec!["Execution completed successfully".to_owned()],
        time: Some(0.5),
        time_limit: Some(1.0),
        memory: Some(100),
    }
}

/// A submission over the whole dataset, every testcase one unless `outcomes` says otherwise.
pub fn submission(outcomes: &[(&str, f64)]) -> Submission {
    let outcomes: BTreeMap<&str, f64> = outcomes.iter().copied().collect();
    let testcases = public_testcases()
        .keys()
        .rev()
        .map(|codename| {
            let outcome = outcomes.get(codename.as_str()).copied().unwrap_or(1.0);
            evaluated(codename, outcome)
        })
        .collect();
    Submission {
        evaluated: true,
        score_precision: 4,
        testcases,
    }
}

/// A submission the compiler never got to evaluate.
pub fn unevaluated() -> Submission {
    Submission {
        evaluated: false,
        score_precision: 4,
        testcases: Vec::new(),
    }
}

/// A subtask's fraction, its displayed score and its weight.
pub fn subtask(details: &ScoreDetails, index: usize) -> (f64, f64, f64) {
    match &entries(details)[index] {
        Subtask::Scored {
            score_fraction,
            score,
            max_score,
            ..
        } => (*score_fraction, *score, *max_score),
        other => panic!("subtask {index} is not scored: {other:?}"),
    }
}

/// Whether the subtask at `index` is the one whose weighting a contestant is not shown.
pub fn is_unscored(details: &ScoreDetails, index: usize) -> bool {
    matches!(&entries(details)[index], Subtask::Unscored { .. })
}

/// A subtask's rows.
pub fn rows(details: &ScoreDetails, index: usize) -> &[Row] {
    match &entries(details)[index] {
        Subtask::Scored { testcases, .. } | Subtask::Unscored { testcases, .. } => testcases,
    }
}

/// `Sum`'s rows.
pub fn sum_rows(details: &ScoreDetails) -> &[SumRow] {
    match details {
        ScoreDetails::Testcases(rows) => rows,
        other => panic!("the details are not a table of testcases: {other:?}"),
    }
}

/// The subtasks of a document.
pub fn entries(details: &ScoreDetails) -> &[Subtask] {
    match details {
        ScoreDetails::Subtasks(subtasks) => subtasks,
        other => panic!("the details are not subtasks: {other:?}"),
    }
}
