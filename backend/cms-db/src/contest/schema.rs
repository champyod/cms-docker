//! The `contests` table as a declaration: every column, in the order the
//! reference declares it, with the Rust type each one holds.
//!
//! `src/cms/db/contest.py:51-326` is the source. A column that fills itself when
//! an insert omits it is `generated`, a nullable one is `optional`, and the four
//! foreign-key-less relationships at the end of the class are named rather than
//! held, since a struct carries values and not a mapper.

use crate::base::{ArrayItem, Column, ColumnKind, Declaration};

/// The `contests` table (`src/cms/db/contest.py:51-364`).
pub const CONTEST: Declaration = Declaration {
    table: "contests",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("name", ColumnKind::Text),
        Column::required("description", ColumnKind::Text),
        Column::generated("allowed_localizations", ColumnKind::Array(ArrayItem::Text)),
        Column::generated("languages", ColumnKind::Array(ArrayItem::Text)),
        Column::generated("submissions_download_allowed", ColumnKind::Boolean),
        Column::generated("allow_questions", ColumnKind::Boolean),
        Column::generated("allow_user_tests", ColumnKind::Boolean),
        Column::generated(
            "allow_unofficial_submission_before_analysis_mode",
            ColumnKind::Boolean,
        ),
        Column::generated("block_hidden_participations", ColumnKind::Boolean),
        Column::generated("allow_password_authentication", ColumnKind::Boolean),
        Column::generated("allow_registration", ColumnKind::Boolean),
        Column::generated("ip_restriction", ColumnKind::Boolean),
        Column::generated("ip_autologin", ColumnKind::Boolean),
        Column::generated("token_mode", ColumnKind::Enum),
        Column::optional("token_max_number", ColumnKind::Integer),
        Column::generated("token_min_interval", ColumnKind::Interval),
        Column::generated("token_gen_initial", ColumnKind::Integer),
        Column::generated("token_gen_number", ColumnKind::Integer),
        Column::generated("token_gen_interval", ColumnKind::Interval),
        Column::optional("token_gen_max", ColumnKind::Integer),
        Column::generated("start", ColumnKind::Timestamp),
        Column::generated("stop", ColumnKind::Timestamp),
        Column::generated("analysis_enabled", ColumnKind::Boolean),
        Column::generated("analysis_start", ColumnKind::Timestamp),
        Column::generated("analysis_stop", ColumnKind::Timestamp),
        Column::optional("timezone", ColumnKind::Text),
        Column::optional("per_user_time", ColumnKind::Interval),
        Column::optional("max_submission_number", ColumnKind::Integer),
        Column::optional("max_user_test_number", ColumnKind::Integer),
        Column::optional("min_submission_interval", ColumnKind::Interval),
        Column::optional("min_submission_interval_grace_period", ColumnKind::Interval),
        Column::optional("min_user_test_interval", ColumnKind::Interval),
        Column::generated("evaluation_throttle_delay_s", ColumnKind::Integer),
        Column::generated("evaluation_throttle_window_s", ColumnKind::Integer),
        Column::generated("evaluation_throttle_max", ColumnKind::Integer),
        Column::generated("evaluation_final_open", ColumnKind::Boolean),
        Column::optional("evaluation_final_open_at", ColumnKind::Timestamp),
        Column::generated("queue_fairness_penalty_seconds", ColumnKind::Integer),
        Column::generated("score_precision", ColumnKind::Integer),
        Column::generated("is_active", ColumnKind::Boolean),
    ],
    relationships: &[
        "task_contests",
        "tasks",
        "announcements",
        "participations",
        "contest_teams",
    ],
};
