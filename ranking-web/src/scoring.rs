use std::collections::BTreeMap;

use serde::Serialize;

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
    fn entries(&self, user: &str, task: &str) -> Vec<SubmissionEntry> {
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

/// The scoreboard, assembled from the projection.
#[derive(Debug, Default, Clone)]
pub struct Ledger {
    scores: BTreeMap<String, BTreeMap<String, f64>>,
    history: Vec<(String, String, i64, f64)>,
    submissions: Vec<SubmissionEntry>,
    skipped_subchanges: usize,
}

impl Ledger {
    /// Scores strictly above zero, the way ScoreHandler filters them.
    pub fn scores(&self) -> &BTreeMap<String, BTreeMap<String, f64>> {
        &self.scores
    }

    pub fn history(&self) -> &[(String, String, i64, f64)] {
        &self.history
    }

    pub fn skipped_subchanges(&self) -> usize {
        self.skipped_subchanges
    }

    /// One user's submissions, ordered by (task, time) the way the Python
    /// SubListHandler sorted them. A user with none yields an empty list, which is
    /// the route's honest answer rather than a 404.
    pub fn sublist(&self, user: &str) -> Vec<&SubmissionEntry> {
        let mut entries: Vec<&SubmissionEntry> = self
            .submissions
            .iter()
            .filter(|entry| entry.user == user)
            .collect();
        entries.sort_by(|left, right| {
            left.task
                .cmp(&right.task)
                .then_with(|| left.time.cmp(&right.time))
                .then_with(|| left.key.cmp(&right.key))
        });
        entries
    }
}

/// Replays the projection into a scoreboard. Subchanges are applied in (time, key)
/// order, which is the order Score.create_subchange keeps them in after any
/// out-of-order arrival forces a reset.
pub fn assemble(
    tasks: &[TaskMode],
    submissions: &[Submission],
    subchanges: &[Subchange],
) -> Result<Ledger, ScoreError> {
    let mut scores: BTreeMap<(String, String), Score> = BTreeMap::new();
    let mut skipped = 0;
    for submission in submissions {
        let mode = tasks
            .iter()
            .find(|task| task.key == submission.task)
            .map(|task| task.mode);
        let Some(mode) = mode else {
            skipped += 1;
            continue;
        };
        scores
            .entry((submission.user.clone(), submission.task.clone()))
            .or_insert_with(|| Score::new(mode))
            .register(&submission.key, submission.time);
    }
    let owners: BTreeMap<&str, (&str, &str)> = submissions
        .iter()
        .map(|submission| {
            (
                submission.key.as_str(),
                (submission.user.as_str(), submission.task.as_str()),
            )
        })
        .collect();
    let mut ordered: Vec<&Subchange> = subchanges.iter().collect();
    ordered.sort_by(|left, right| {
        left.time
            .cmp(&right.time)
            .then_with(|| left.key.cmp(&right.key))
    });
    for change in ordered {
        let Some((user, task)) = owners.get(change.submission.as_str()) else {
            skipped += 1;
            continue;
        };
        if let Some(score) = scores.get_mut(&(user.to_string(), task.to_string())) {
            score.append(change);
        }
    }
    Ok(finish(scores, skipped))
}

fn finish(scores: BTreeMap<(String, String), Score>, skipped: usize) -> Ledger {
    let mut ledger = Ledger {
        skipped_subchanges: skipped,
        ..Ledger::default()
    };
    let mut merged: Vec<(String, String, i64, f64)> = Vec::new();
    for ((user, task), score) in &scores {
        let value = score.value();
        if value > 0.0 {
            ledger
                .scores
                .entry(user.clone())
                .or_default()
                .insert(task.clone(), value);
        }
        for (time, change) in score.history() {
            merged.push((user.clone(), task.clone(), *time, *change));
        }
        ledger.submissions.extend(score.entries(user, task));
    }
    merged.sort_by(|left, right| {
        left.2
            .cmp(&right.2)
            .then_with(|| {
                left.3
                    .partial_cmp(&right.3)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.0.cmp(&right.0))
            .then_with(|| left.1.cmp(&right.1))
    });
    ledger.history = merged;
    ledger
}
