//! The driver-facing shape of one `contests` row, and the model it maps onto.
//!
//! Two columns carry a domain — the name and the token mode — so the mapping is
//! written out and names the column when either refuses the value it holds.

use chrono::NaiveDateTime;

use crate::codename::Codename;
use crate::interval::Interval;
use crate::token_mode::TokenMode;

use super::model::Contest;

/// A `contests` row before its name and token mode are typed.
#[derive(Debug, sqlx::FromRow)]
pub(super) struct ContestRow {
    pub(super) id: i32,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) allowed_localizations: Vec<String>,
    pub(super) languages: Vec<String>,
    pub(super) submissions_download_allowed: bool,
    pub(super) allow_questions: bool,
    pub(super) allow_user_tests: bool,
    pub(super) allow_unofficial_submission_before_analysis_mode: bool,
    pub(super) block_hidden_participations: bool,
    pub(super) allow_password_authentication: bool,
    pub(super) allow_registration: bool,
    pub(super) ip_restriction: bool,
    pub(super) ip_autologin: bool,
    pub(super) token_mode: String,
    pub(super) token_max_number: Option<i32>,
    pub(super) token_min_interval: Interval,
    pub(super) token_gen_initial: i32,
    pub(super) token_gen_number: i32,
    pub(super) token_gen_interval: Interval,
    pub(super) token_gen_max: Option<i32>,
    pub(super) start: NaiveDateTime,
    pub(super) stop: NaiveDateTime,
    pub(super) analysis_enabled: bool,
    pub(super) analysis_start: NaiveDateTime,
    pub(super) analysis_stop: NaiveDateTime,
    pub(super) timezone: Option<String>,
    pub(super) per_user_time: Option<Interval>,
    pub(super) max_submission_number: Option<i32>,
    pub(super) max_user_test_number: Option<i32>,
    pub(super) min_submission_interval: Option<Interval>,
    pub(super) min_submission_interval_grace_period: Option<Interval>,
    pub(super) min_user_test_interval: Option<Interval>,
    pub(super) evaluation_throttle_delay_s: i32,
    pub(super) evaluation_throttle_window_s: i32,
    pub(super) evaluation_throttle_max: i32,
    pub(super) evaluation_final_open: bool,
    pub(super) evaluation_final_open_at: Option<NaiveDateTime>,
    pub(super) queue_fairness_penalty_seconds: i32,
    pub(super) score_precision: i32,
    pub(super) is_active: bool,
}

impl TryFrom<ContestRow> for Contest {
    type Error = sqlx::Error;

    /// # Errors
    ///
    /// Returns [`sqlx::Error::ColumnDecode`] naming `contests.name` or
    /// `contests.token_mode` when the value is outside the rule the column declares.
    fn try_from(row: ContestRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            name: Codename::parse(&row.name).map_err(|source| refused("contests.name", source))?,
            description: row.description,
            allowed_localizations: row.allowed_localizations,
            languages: row.languages,
            submissions_download_allowed: row.submissions_download_allowed,
            allow_questions: row.allow_questions,
            allow_user_tests: row.allow_user_tests,
            allow_unofficial_submission_before_analysis_mode: row
                .allow_unofficial_submission_before_analysis_mode,
            block_hidden_participations: row.block_hidden_participations,
            allow_password_authentication: row.allow_password_authentication,
            allow_registration: row.allow_registration,
            ip_restriction: row.ip_restriction,
            ip_autologin: row.ip_autologin,
            token_mode: TokenMode::parse(&row.token_mode).ok_or_else(|| {
                refused(
                    "contests.token_mode",
                    format!("{:?} is not a token mode", row.token_mode),
                )
            })?,
            token_max_number: row.token_max_number,
            token_min_interval: row.token_min_interval,
            token_gen_initial: row.token_gen_initial,
            token_gen_number: row.token_gen_number,
            token_gen_interval: row.token_gen_interval,
            token_gen_max: row.token_gen_max,
            start: row.start,
            stop: row.stop,
            analysis_enabled: row.analysis_enabled,
            analysis_start: row.analysis_start,
            analysis_stop: row.analysis_stop,
            timezone: row.timezone,
            per_user_time: row.per_user_time,
            max_submission_number: row.max_submission_number,
            max_user_test_number: row.max_user_test_number,
            min_submission_interval: row.min_submission_interval,
            min_submission_interval_grace_period: row.min_submission_interval_grace_period,
            min_user_test_interval: row.min_user_test_interval,
            evaluation_throttle_delay_s: row.evaluation_throttle_delay_s,
            evaluation_throttle_window_s: row.evaluation_throttle_window_s,
            evaluation_throttle_max: row.evaluation_throttle_max,
            evaluation_final_open: row.evaluation_final_open,
            evaluation_final_open_at: row.evaluation_final_open_at,
            queue_fairness_penalty_seconds: row.queue_fairness_penalty_seconds,
            score_precision: row.score_precision,
            is_active: row.is_active,
        })
    }
}

/// Names the column whose domain refused the value it held.
fn refused(
    column: &'static str,
    source: impl Into<Box<dyn std::error::Error + Send + Sync>>,
) -> sqlx::Error {
    sqlx::Error::ColumnDecode {
        index: column.to_string(),
        source: source.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A row every column of which the table accepts.
    fn row() -> ContestRow {
        ContestRow {
            id: 3,
            name: "alpha".to_string(),
            description: "Alpha".to_string(),
            allowed_localizations: Vec::new(),
            languages: vec!["Rust".to_string()],
            submissions_download_allowed: true,
            allow_questions: true,
            allow_user_tests: true,
            allow_unofficial_submission_before_analysis_mode: false,
            block_hidden_participations: false,
            allow_password_authentication: true,
            allow_registration: false,
            ip_restriction: true,
            ip_autologin: false,
            token_mode: "finite".to_string(),
            token_max_number: Some(4),
            token_min_interval: Interval::zero(),
            token_gen_initial: 2,
            token_gen_number: 1,
            token_gen_interval: Interval::zero(),
            token_gen_max: Some(3),
            start: NaiveDateTime::default(),
            stop: NaiveDateTime::default(),
            analysis_enabled: false,
            analysis_start: NaiveDateTime::default(),
            analysis_stop: NaiveDateTime::default(),
            timezone: None,
            per_user_time: None,
            max_submission_number: None,
            max_user_test_number: None,
            min_submission_interval: None,
            min_submission_interval_grace_period: None,
            min_user_test_interval: None,
            evaluation_throttle_delay_s: 0,
            evaluation_throttle_window_s: 0,
            evaluation_throttle_max: 0,
            evaluation_final_open: false,
            evaluation_final_open_at: None,
            queue_fairness_penalty_seconds: 0,
            score_precision: 0,
            is_active: false,
        }
    }

    #[test]
    fn a_row_maps_onto_the_contest() {
        let contest = Contest::try_from(row()).expect("the row is valid");

        assert_eq!(contest.id, 3);
        assert_eq!(contest.name.as_str(), "alpha");
        assert_eq!(contest.token_mode, TokenMode::Finite);
        assert_eq!(contest.languages, vec!["Rust".to_string()]);
    }

    #[test]
    fn a_name_outside_the_domain_names_its_column() {
        let mut refused_row = row();
        refused_row.name = "has space".to_string();

        let error = Contest::try_from(refused_row).expect_err("the domain refuses the name");

        assert!(matches!(
            error,
            sqlx::Error::ColumnDecode { ref index, .. } if index == "contests.name"
        ));
    }

    #[test]
    fn a_token_mode_outside_the_enum_names_its_column() {
        let mut refused_row = row();
        refused_row.token_mode = "mixed".to_string();

        let error = Contest::try_from(refused_row).expect_err("the enum refuses the mode");

        assert!(matches!(
            error,
            sqlx::Error::ColumnDecode { ref index, .. } if index == "contests.token_mode"
        ));
    }
}
