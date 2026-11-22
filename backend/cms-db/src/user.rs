//! The `users` and `participations` rows identity and login are held in.
//!
//! `User` is `src/cms/db/user.py:46-117`: the real name, the CWS username, the
//! stored credential, the optional contact and display settings, and the time
//! of the last successful password login. `Participation` is the same file's
//! `src/cms/db/user.py:180-305`: one user's place in one contest, which is the
//! row a display username hangs off.
//!
//! # Passwords
//!
//! A `users.password` is a `<method>:<payload>` string, and `cmscommon.crypto`
//! splits it when a login supplies a candidate (`cmscommon/crypto.py:177-186`).
//! `user.py:71-74` only stores it — a default of `hash_password` over a random
//! password for a new row — and never parses it, so a legacy `plaintext:` row
//! is read as the value it is. The refusal is at verification, not at the
//! boundary: [`PasswordForm::verify`] answers `false` for a plaintext row
//! (`cmscommon/crypto.py:214-223`), so nothing authenticates from a dump of the
//! table.
//!
//! A `participations.password`, when present, replaces the user's credential
//! for that contest alone (`src/cms/server/contest/authentication.py:60-65`),
//! and is the same `<method>:<payload>` form checked by the same function.
//!
//! Divergence: a stored value with no colon or with a method that is neither
//! `plaintext` nor `bcrypt` is refused by [`PasswordForm::parse`] when the row
//! is built, where `user.py` would hold the string and fail the login later.
//! The row could never authenticate either way — every Python login path wraps
//! `validate_password` and treats its `ValueError` as a failed login — so the
//! earlier refusal cannot admit a credential the reference refuses.
//!
//! # Scope
//!
//! `Team`, `Message` and `Question` sit in the same reference file but carry no
//! identity, username or permission rule, so they are not part of this lane.

use chrono::NaiveDateTime;

use crate::auth::{BcryptVerifier, PasswordForm};
use crate::base::{ArrayItem, Column, ColumnKind, Declaration};
use crate::codename::Codename;
use crate::interval::Interval;

/// The `users` table (`src/cms/db/user.py:51-70`).
pub const USER: Declaration = Declaration {
    table: "users",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("first_name", ColumnKind::Text),
        Column::required("last_name", ColumnKind::Text),
        Column::required("username", ColumnKind::Text),
        Column::generated("password", ColumnKind::Text),
        Column::optional("email", ColumnKind::Text),
        Column::optional("timezone", ColumnKind::Text),
        Column::generated("preferred_languages", ColumnKind::Array(ArrayItem::Text)),
        Column::optional("last_login_at", ColumnKind::Timestamp),
    ],
    relationships: &["participations"],
};

/// The `participations` table (`src/cms/db/user.py:184-265`).
pub const PARTICIPATION: Declaration = Declaration {
    table: "participations",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::optional("ip", ColumnKind::Array(ArrayItem::Text)),
        Column::optional("starting_time", ColumnKind::Timestamp),
        Column::generated("delay_time", ColumnKind::Interval),
        Column::generated("extra_time", ColumnKind::Interval),
        Column::optional("password", ColumnKind::Text),
        Column::generated("hidden", ColumnKind::Boolean),
        Column::generated("unrestricted", ColumnKind::Boolean),
        Column::reference("contest_id", ColumnKind::Integer),
        Column::reference("user_id", ColumnKind::Integer),
        Column::optional_reference("team_id", ColumnKind::Integer),
    ],
    relationships: &[
        "contest",
        "user",
        "team",
        "messages",
        "questions",
        "submissions",
        "user_tests",
    ],
};

/// A row of `users`, with the credential already split into its method.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    /// `users.id`.
    pub id: i32,
    /// `users.first_name`.
    pub first_name: String,
    /// `users.last_name`.
    pub last_name: String,
    /// `users.username`, which the `CODENAME` domain admits.
    pub username: Codename,
    /// `users.password`, as the `<method>:<payload>` form the column holds.
    pub password: PasswordForm,
    /// `users.email`.
    pub email: Option<String>,
    /// `users.timezone`, an IANA zone name.
    pub timezone: Option<String>,
    /// `users.preferred_languages`, most preferred first.
    pub preferred_languages: Vec<String>,
    /// `users.last_login_at`, absent before the first successful login.
    pub last_login_at: Option<NaiveDateTime>,
}

impl User {
    /// Whether `candidate` is this user's password.
    ///
    /// A plaintext row answers `false` without comparing, which is what
    /// `validate_password` does for the same reason: the column is readable, so
    /// honouring it would hand the account to anyone who can `SELECT` it.
    #[must_use]
    pub fn verify_password(&self, candidate: &str, verifier: &impl BcryptVerifier) -> bool {
        self.password.verify(candidate, verifier)
    }
}

/// A row of `participations`: one user's entry in one contest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Participation {
    /// `participations.id`.
    pub id: i32,
    /// `participations.ip`, the subnets a login is allowed from.
    pub ip: Option<Vec<String>>,
    /// `participations.starting_time`, when the contestant's window opened.
    pub starting_time: Option<NaiveDateTime>,
    /// `participations.delay_time`, the shift applied to submission windows.
    pub delay_time: Interval,
    /// `participations.extra_time`, the time granted beyond the contest's own.
    pub extra_time: Interval,
    /// `participations.password`, which replaces the user's for this contest.
    pub password: Option<PasswordForm>,
    /// `participations.hidden`, excluded from public rankings.
    pub hidden: bool,
    /// `participations.unrestricted`, exempt from contest limits.
    pub unrestricted: bool,
    /// `participations.contest_id`.
    pub contest_id: i32,
    /// `participations.user_id`.
    pub user_id: i32,
    /// `participations.team_id`.
    pub team_id: Option<i32>,
}

impl Participation {
    /// The credential a login against this participation is checked with.
    ///
    /// The participation's own password replaces the user's when it is set,
    /// and the user's is the fallback (`authentication.py:60-65`).
    #[must_use]
    pub fn credential<'a>(&'a self, user: &'a User) -> &'a PasswordForm {
        self.password.as_ref().unwrap_or(&user.password)
    }
}
