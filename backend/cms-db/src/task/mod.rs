//! The `tasks` row: `src/cms/db/task.py:52-301`, with its token columns and language fallback.

use sqlx::postgres::PgConnection;

use crate::base::{ArrayItem, Column, ColumnKind, Declaration};
use crate::codename::{Codename, CodenameError};
use crate::interval::Interval;
use crate::reads::DatasetId;

mod dataset;
mod quota;
mod settings;
mod token;

pub use dataset::{
    activate_dataset, dataset_by_id, delete_dataset, unjudged_submissions, ACTIVATE_DATASET,
    DELETE_DATASET, SUBMISSIONS_WITHOUT_RESULT,
};
pub use quota::{merge, Playable, Tokens};
pub use settings::{FeedbackLevel, ScoreMode};
pub use token::TokenRules;

use crate::token_mode::TokenMode;

/// The `tasks` table (`src/cms/db/task.py:56-283`).
pub const TASK: Declaration = Declaration {
    table: "tasks",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("name", ColumnKind::Text),
        Column::required("title", ColumnKind::Text),
        Column::generated("submission_format", ColumnKind::Array(ArrayItem::Text)),
        Column::generated("primary_statements", ColumnKind::Array(ArrayItem::Text)),
        Column::optional("allowed_languages", ColumnKind::Array(ArrayItem::Text)),
        Column::generated("token_mode", ColumnKind::Enum),
        Column::optional("token_max_number", ColumnKind::Integer),
        Column::generated("token_min_interval", ColumnKind::Interval),
        Column::generated("token_gen_initial", ColumnKind::Integer),
        Column::generated("token_gen_number", ColumnKind::Integer),
        Column::generated("token_gen_interval", ColumnKind::Interval),
        Column::optional("token_gen_max", ColumnKind::Integer),
        Column::optional("max_submission_number", ColumnKind::Integer),
        Column::optional("max_user_test_number", ColumnKind::Integer),
        Column::optional("min_submission_interval", ColumnKind::Interval),
        Column::optional("min_user_test_interval", ColumnKind::Interval),
        Column::optional("evaluation_throttle_delay_s", ColumnKind::Integer),
        Column::generated("feedback_level", ColumnKind::Enum),
        Column::generated("score_precision", ColumnKind::Integer),
        Column::generated("score_mode", ColumnKind::Enum),
        Column::optional_reference("active_dataset_id", ColumnKind::Integer),
    ],
    relationships: &[
        "contest_tasks",
        "contests",
        "statements",
        "attachments",
        "datasets",
        "submissions",
        "user_tests",
    ],
};

/// The columns one `tasks` row is read with, bound to its own id as `$1`.
pub const TASK_BY_ID: &str = "\
    SELECT id, name, title, submission_format, primary_statements, allowed_languages,
           token_mode, token_max_number, token_min_interval,
           token_gen_initial, token_gen_number, token_gen_interval, token_gen_max,
           max_submission_number, max_user_test_number,
           min_submission_interval, min_user_test_interval,
           evaluation_throttle_delay_s, feedback_level, score_precision, score_mode,
           active_dataset_id
    FROM tasks
    WHERE id = $1";

/// One task: its identity, the languages it admits, its token quota and its scope.
#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    /// `tasks.id`.
    pub id: i32,
    /// `tasks.name`, which the `CODENAME` domain admits and the table holds once.
    pub name: Codename,
    /// `tasks.title`, the human-readable name.
    pub title: String,
    /// `tasks.submission_format`, with the language-specific extension left as `%l`.
    pub submission_format: Vec<String>,
    /// `tasks.primary_statements`, the statement languages to highlight.
    pub primary_statements: Vec<String>,
    /// `tasks.allowed_languages`, absent when the contest decides.
    pub allowed_languages: Option<Vec<String>>,
    /// The four parameters and three caps that set the token quota.
    pub token: TokenRules,
    /// `tasks.max_submission_number`, absent when the task does not cap submissions.
    pub max_submission_number: Option<i32>,
    /// `tasks.max_user_test_number`, absent when the task does not cap user tests.
    pub max_user_test_number: Option<i32>,
    /// `tasks.min_submission_interval`, absent when two submissions may be simultaneous.
    pub min_submission_interval: Option<Interval>,
    /// `tasks.min_user_test_interval`, absent when two user tests may be simultaneous.
    pub min_user_test_interval: Option<Interval>,
    /// `tasks.evaluation_throttle_delay_s`, which wins over the contest's delay.
    pub evaluation_throttle_delay_s: Option<i32>,
    /// `tasks.feedback_level`.
    pub feedback_level: FeedbackLevel,
    /// `tasks.score_precision`, the decimal places the score is rounded to.
    pub score_precision: i32,
    /// `tasks.score_mode`.
    pub score_mode: ScoreMode,
    /// `tasks.active_dataset_id`, absent before a dataset is activated.
    pub active_dataset_id: Option<DatasetId>,
}

impl Task {
    /// One task by id, or `None` when the table holds no such row.
    ///
    /// # Errors
    ///
    /// Returns [`TaskError`] for a column the driver refused, a name the
    /// `CODENAME` domain refuses, or an enum value the column does not declare.
    pub async fn get(connection: &mut PgConnection, id: i32) -> Result<Option<Self>, TaskError> {
        let row = sqlx::query_as::<_, TaskRow>(TASK_BY_ID)
            .bind(id)
            .fetch_optional(connection)
            .await?;
        row.map(Task::try_from).transpose()
    }

    /// The languages a contest may use: the task's own or its only contest's, since a shared task has no fallback (`task.py:294-301`).
    #[must_use]
    pub fn get_allowed_languages(&self, contests: &[Vec<String>]) -> Option<Vec<String>> {
        if let Some(languages) = &self.allowed_languages {
            return Some(languages.clone());
        }
        match contests {
            [only] => Some(only.clone()),
            _ => None,
        }
    }
}

/// The driver-facing shape of a `tasks` row, before its three enum columns are typed.
#[derive(Debug, sqlx::FromRow)]
struct TaskRow {
    id: i32,
    name: String,
    title: String,
    submission_format: Vec<String>,
    primary_statements: Vec<String>,
    allowed_languages: Option<Vec<String>>,
    token_mode: String,
    token_max_number: Option<i32>,
    token_min_interval: Interval,
    token_gen_initial: i32,
    token_gen_number: i32,
    token_gen_interval: Interval,
    token_gen_max: Option<i32>,
    max_submission_number: Option<i32>,
    max_user_test_number: Option<i32>,
    min_submission_interval: Option<Interval>,
    min_user_test_interval: Option<Interval>,
    evaluation_throttle_delay_s: Option<i32>,
    feedback_level: String,
    score_precision: i32,
    score_mode: String,
    active_dataset_id: Option<i32>,
}

impl TryFrom<TaskRow> for Task {
    type Error = TaskError;

    /// # Errors
    ///
    /// Returns [`TaskError`] for a name or an enum value the model's own types refuse.
    fn try_from(row: TaskRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            name: Codename::parse(&row.name).map_err(TaskError::Name)?,
            title: row.title,
            submission_format: row.submission_format,
            primary_statements: row.primary_statements,
            allowed_languages: row.allowed_languages,
            token: TokenRules {
                mode: TokenMode::parse(&row.token_mode).ok_or_else(|| TaskError::Unreadable {
                    column: "tasks.token_mode",
                    value: row.token_mode,
                })?,
                max_number: row.token_max_number,
                min_interval: row.token_min_interval,
                gen_initial: row.token_gen_initial,
                gen_number: row.token_gen_number,
                gen_interval: row.token_gen_interval,
                gen_max: row.token_gen_max,
            },
            max_submission_number: row.max_submission_number,
            max_user_test_number: row.max_user_test_number,
            min_submission_interval: row.min_submission_interval,
            min_user_test_interval: row.min_user_test_interval,
            evaluation_throttle_delay_s: row.evaluation_throttle_delay_s,
            feedback_level: FeedbackLevel::parse(&row.feedback_level).ok_or_else(|| {
                TaskError::Unreadable {
                    column: "tasks.feedback_level",
                    value: row.feedback_level,
                }
            })?,
            score_precision: row.score_precision,
            score_mode: ScoreMode::parse(&row.score_mode).ok_or_else(|| TaskError::Unreadable {
                column: "tasks.score_mode",
                value: row.score_mode,
            })?,
            active_dataset_id: row.active_dataset_id.map(DatasetId),
        })
    }
}

/// Why a `tasks` row could not be read or a dataset could not be activated.
#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    /// `tasks.name` holds a value the `CODENAME` domain refuses.
    #[error("tasks.name is not a codename: {0}")]
    Name(#[source] CodenameError),
    /// An enum column holds a value its enum does not declare.
    #[error("{column} holds {value:?}, which the column's enum does not declare")]
    Unreadable {
        /// The column the value was read from.
        column: &'static str,
        /// The value it held.
        value: String,
    },
    /// The dataset named belongs to another task, which the reference's composite key refuses.
    #[error("dataset {dataset} does not belong to task {task}")]
    DatasetOfAnotherTask {
        /// The dataset the caller named.
        dataset: DatasetId,
        /// The task that was being activated on.
        task: i32,
    },
    /// A read or a write the driver refused.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}
