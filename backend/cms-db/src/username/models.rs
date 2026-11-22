//! The five tables the display-username feature reads and writes.
//!
//! `src/cms/db/username/models.py:36-175` declares them, and each declaration
//! below keeps its table, columns and relationships. Two rules the reference
//! states in `__table_args__` do not fit a [`Declaration`] because they are
//! constraints rather than columns, and they stay with the write that enforces
//! them:
//!
//! - `contestant_group_memberships` is unique on `(user_id, group_id)`;
//! - `contest_usernames` is unique on `(contest_id, username)`, which is the
//!   rule `_assert_username_free` raises on (`resolution.py:141-149`) before a
//!   history row is appended, and unique on `participation_id`;
//! - `username_policies` is unique on `(scope, scope_id)`.
//!
//! `contest_usernames.username` and its history column are declared with the
//! [`Codename`](crate::Codename) domain, so a display name is refused by the
//! same alphabet as a login name. `contest_id` and `user_id` on both tables are
//! denormalised from the participation: they make the per-contest uniqueness
//! and a lookup by user possible without joining through it.

use crate::base::{Column, ColumnKind, Declaration};

/// The `contestant_groups` table.
pub const CONTESTANT_GROUP: Declaration = Declaration {
    table: "contestant_groups",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("name", ColumnKind::Text),
        Column::optional("description", ColumnKind::Text),
        Column::generated("created_at", ColumnKind::Timestamp),
    ],
    relationships: &["memberships"],
};

/// The `contestant_group_memberships` table.
pub const CONTESTANT_GROUP_MEMBERSHIP: Declaration = Declaration {
    table: "contestant_group_memberships",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::generated("created_at", ColumnKind::Timestamp),
        Column::reference("user_id", ColumnKind::Integer),
        Column::reference("group_id", ColumnKind::Integer),
    ],
    relationships: &["user", "group"],
};

/// The `username_policies` table.
pub const USERNAME_POLICY: Declaration = Declaration {
    table: "username_policies",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("scope", ColumnKind::Enum),
        Column::required("scope_id", ColumnKind::Integer),
        Column::required("policy", ColumnKind::Enum),
        Column::generated("updated_at", ColumnKind::Timestamp),
        Column::optional_reference("updated_by", ColumnKind::Integer),
    ],
    relationships: &["updater"],
};

/// The `contest_usernames` table.
pub const CONTEST_USERNAME: Declaration = Declaration {
    table: "contest_usernames",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("username", ColumnKind::Text),
        Column::required("updated_at", ColumnKind::Timestamp),
        Column::optional_reference("updated_by_admin_id", ColumnKind::Integer),
        Column::reference("participation_id", ColumnKind::Integer),
        Column::reference("contest_id", ColumnKind::Integer),
        Column::reference("user_id", ColumnKind::Integer),
    ],
    relationships: &["updated_by_admin", "participation", "contest", "user"],
};

/// The `contest_usernames_history` table.
pub const CONTEST_USERNAME_HISTORY: Declaration = Declaration {
    table: "contest_usernames_history",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::optional("username", ColumnKind::Text),
        Column::required("set_at", ColumnKind::Timestamp),
        Column::optional_reference("set_by_admin_id", ColumnKind::Integer),
        Column::reference("contest_id", ColumnKind::Integer),
        Column::reference("user_id", ColumnKind::Integer),
    ],
    relationships: &["set_by_admin"],
};
