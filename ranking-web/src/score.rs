use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

/// The score modes the CMS scorer implements (src/cmscommon/constants.py).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScoreMode {
    Max,
    MaxSubtask,
    MaxTokenedLast,
}

impl ScoreMode {
    pub fn from_wire(raw: &str) -> Option<Self> {
        match raw {
            "max" => Some(Self::Max),
            "max_subtask" => Some(Self::MaxSubtask),
            "max_tokened_last" => Some(Self::MaxTokenedLast),
            _ => None,
        }
    }
}

/// A pushed submission, reduced to what the score depends on.
#[derive(Debug, Clone)]
pub struct Submission {
    pub key: String,
    pub user: String,
    pub task: String,
    pub time: i64,
}

/// A pushed subchange. Every field except the key and the target may be absent,
/// which is what makes a change a partial update rather than a replacement.
#[derive(Debug, Clone)]
pub struct Subchange {
    pub key: String,
    pub submission: String,
    pub time: i64,
    pub score: Option<f64>,
    pub token: Option<bool>,
    pub extra: Option<Vec<f64>>,
}

/// The `extra` column is a JSON array of numeric strings (the CMS column is
/// `character varying[]`); a real number is accepted too, and both become scores.
pub fn parse_extra(value: &Value) -> Option<Vec<f64>> {
    value
        .as_array()
        .map(|values| values.iter().filter_map(as_score).collect())
}

fn as_score(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
}

/// One user/task pair's mode and the submission keys that belong to it.
#[derive(Debug, Clone)]
pub struct TaskMode {
    pub key: String,
    pub mode: ScoreMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScoreError {
    UnknownScoreMode { task: String, mode: String },
}

impl std::fmt::Display for ScoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownScoreMode { task, mode } => write!(
                formatter,
                "task {task} declares an unknown score mode: {mode}"
            ),
        }
    }
}

impl std::error::Error for ScoreError {}

#[derive(Debug, Clone)]
struct SubmissionState {
    time: i64,
    score: f64,
    token: bool,
    extra: Vec<f64>,
}

/// Mirrors cmsranking.Scoring.Score for one user/task pair.
#[derive(Debug, Clone)]
pub struct Score {
    mode: ScoreMode,
    submissions: BTreeMap<String, SubmissionState>,
    released: Vec<f64>,
    last: Option<(i64, f64)>,
    history: Vec<(i64, f64)>,
}

impl Score {
    pub fn new(mode: ScoreMode) -> Self {
        Self {
            mode,
            submissions: BTreeMap::new(),
            released: Vec::new(),
            last: None,
            history: Vec::new(),
        }
    }

    pub fn register(&mut self, key: &str, time: i64) {
        self.submissions.insert(
            key.to_string(),
            SubmissionState {
                time,
                score: 0.0,
                token: false,
                extra: Vec::new(),
            },
        );
    }

    pub fn value(&self) -> f64 {
        self.history.last().map_or(0.0, |(_, value)| *value)
    }

    pub fn history(&self) -> &[(i64, f64)] {
        &self.history
    }

    /// Mirrors Score.append_change. The released set is a multiset because two
    /// submissions of one task may hold the same score, and removing one must
    /// not remove the other.
    pub fn append(&mut self, change: &Subchange) {
        let Some(state) = self.submissions.get_mut(&change.submission) else {
            return;
        };
        if state.token {
            remove_one(&mut self.released, state.score);
        }
        if let Some(score) = change.score {
            state.score = score;
        }
        if let Some(token) = change.token {
            state.token = token;
        }
        if let Some(extra) = &change.extra {
            state.extra = extra.clone();
        }
        let current = state.score;
        let token = state.token;
        let time = state.time;
        if token {
            self.released.push(current);
        }
        if change.score.is_some() && self.last.is_none_or(|(last_time, _)| time > last_time) {
            self.last = Some((time, current));
        }
        let computed = self.compute();
        if computed != self.value() {
            self.history.push((change.time, computed));
        }
    }

    fn compute(&self) -> f64 {
        match self.mode {
            ScoreMode::Max => max_or_zero(self.submissions.values().map(|state| state.score)),
            ScoreMode::MaxSubtask => self.subtask_sum(),
            ScoreMode::MaxTokenedLast => {
                let released = query_or_zero(self.released.iter().copied());
                let last = self.last.map_or(0.0, |(_, value)| value);
                released.max(last)
            }
        }
    }

    /// The per-submission state /sublist needs, in the field order the Python
    /// entity's __dict__ produced.
    pub(crate) fn entries(&self, user: &str, task: &str) -> Vec<SubmissionEntry> {
        self.submissions
            .iter()
            .map(|(key, state)| SubmissionEntry {
                user: user.to_string(),
                task: task.to_string(),
                time: state.time,
                key: key.clone(),
                score: state.score,
                token: state.token,
                extra: state.extra.clone(),
            })
            .collect()
    }

    /// Element-wise maximum across the submissions' score vectors, summed.
    /// A submission with no extra list contributes its own score as a one-element
    /// vector, which is what `s.extra or [s.score]` does in Python.
    fn subtask_sum(&self) -> f64 {
        let vectors: Vec<Vec<f64>> = self
            .submissions
            .values()
            .map(|state| {
                if state.extra.is_empty() {
                    vec![state.score]
                } else {
                    state.extra.clone()
                }
            })
            .collect();
        let width = vectors.iter().map(Vec::len).max().unwrap_or(0);
        (0..width)
            .map(|index| {
                max_or_zero(
                    vectors
                        .iter()
                        .map(|vector| vector.get(index).copied().unwrap_or(0.0)),
                )
            })
            .sum()
    }
}

/// Python's max(..., default=0.0): the largest value, or 0.0 when there is none.
/// It is not `fold(0.0, max)`: a single negative score must survive.
fn max_or_zero(values: impl Iterator<Item = f64>) -> f64 {
    values
        .fold(None, |best, value| match best {
            Some(current) if current >= value => Some(current),
            _ => Some(value),
        })
        .unwrap_or(0.0)
}

/// Python's NumberSet.query(): max(values + [0.0]). Unlike max_or_zero this
/// cannot go negative, which is exactly how a released set of negative scores
/// still contributes 0.0 to max_tokened_last.
fn query_or_zero(values: impl Iterator<Item = f64>) -> f64 {
    values
        .chain(std::iter::once(0.0))
        .fold(f64::NEG_INFINITY, f64::max)
}

fn remove_one(values: &mut Vec<f64>, target: f64) {
    if let Some(position) = values.iter().position(|value| *value == target) {
        values.remove(position);
    }
}

/// One submission as /sublist serves it. WHY this carries more than Submission:
/// the Python SubListHandler serialises Submission.__dict__ directly, so the store
/// key and the scorer's per-submission score, token and extra cross the wire even
/// though Submission.get() would have dropped them.
#[derive(Debug, Clone, Serialize)]
pub struct SubmissionEntry {
    pub user: String,
    pub task: String,
    pub time: i64,
    pub key: String,
    pub score: f64,
    pub token: bool,
    pub extra: Vec<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subchange(
        key: &str,
        submission: &str,
        time: i64,
        score: f64,
        extra: [&str; 2],
    ) -> Subchange {
        Subchange {
            key: key.to_string(),
            submission: submission.to_string(),
            time,
            score: Some(score),
            token: None,
            extra: parse_extra(&serde_json::json!(extra)),
        }
    }

    /// The regression: the projection stores `extra` as numeric strings, so a parser
    /// that keeps only JSON numbers drops every subtask and the mode reads as max.
    #[test]
    fn parse_extra_reads_the_numeric_strings_the_projection_stores() {
        assert_eq!(
            parse_extra(&serde_json::json!(["30", "0"])),
            Some(vec![30.0, 0.0])
        );
        assert_eq!(
            parse_extra(&serde_json::json!([30.0, 0.0])),
            Some(vec![30.0, 0.0])
        );
        assert_eq!(parse_extra(&serde_json::json!([])), Some(Vec::new()));
        assert!(parse_extra(&serde_json::json!("30")).is_none());
    }

    #[test]
    fn max_subtask_sums_the_per_subtask_maxima_over_string_extras() {
        let mut score = Score::new(ScoreMode::MaxSubtask);
        score.register("s0", 1);
        score.register("s1", 2);
        score.append(&subchange("c0", "s0", 1, 30.0, ["30", "0"]));
        score.append(&subchange("c1", "s1", 2, 70.0, ["0", "70"]));
        assert_eq!(score.value(), 100.0);
    }
}
