//! The five user-test tables as declarations, in the order the reference
//! declares their columns.
//!
//! `src/cms/db/usertest.py:38-550` is the source. The unique constraints and the
//! composite foreign key are not expressible in a [`Declaration`](crate::Declaration);
//! the rules module beside this one enforces them, and the declarations name the
//! columns they hold.

use crate::base::{ArrayItem, Column, ColumnKind, Declaration};

/// The `user_tests` table (`src/cms/db/usertest.py:38-108`).
pub const USER_TEST: Declaration = Declaration {
    table: "user_tests",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("participation_id", ColumnKind::Integer),
        Column::reference("task_id", ColumnKind::Integer),
        Column::required("timestamp", ColumnKind::Timestamp),
        Column::optional("language", ColumnKind::Text),
        Column::required("input", ColumnKind::Digest),
    ],
    relationships: &["files", "managers", "results"],
};

/// The `user_test_files` table (`src/cms/db/usertest.py:154-186`), unique on
/// `(user_test_id, filename)`.
pub const USER_TEST_FILE: Declaration = Declaration {
    table: "user_test_files",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("user_test_id", ColumnKind::Integer),
        Column::required("filename", ColumnKind::Text),
        Column::required("digest", ColumnKind::Digest),
    ],
    relationships: &["user_test"],
};

/// The `user_test_managers` table (`src/cms/db/usertest.py:189-221`), unique on
/// `(user_test_id, filename)`.
pub const USER_TEST_MANAGER: Declaration = Declaration {
    table: "user_test_managers",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("user_test_id", ColumnKind::Integer),
        Column::required("filename", ColumnKind::Text),
        Column::required("digest", ColumnKind::Digest),
    ],
    relationships: &["user_test"],
};

/// The `user_test_results` table (`src/cms/db/usertest.py:224-373`), keyed and
/// unique on `(user_test_id, dataset_id)`.
pub const USER_TEST_RESULT: Declaration = Declaration {
    table: "user_test_results",
    columns: &[
        Column {
            name: "user_test_id",
            kind: ColumnKind::Integer,
            nullable: false,
            has_default: false,
            primary_key: true,
            foreign_key: true,
        },
        Column {
            name: "dataset_id",
            kind: ColumnKind::Integer,
            nullable: false,
            has_default: false,
            primary_key: true,
            foreign_key: true,
        },
        Column::optional("output", ColumnKind::Digest),
        Column::optional("compilation_outcome", ColumnKind::Text),
        Column::generated("compilation_text", ColumnKind::Array(ArrayItem::Text)),
        Column::generated("compilation_tries", ColumnKind::Integer),
        Column::optional("compilation_stdout", ColumnKind::Text),
        Column::optional("compilation_stderr", ColumnKind::Text),
        Column::optional("compilation_time", ColumnKind::Float),
        Column::optional("compilation_wall_clock_time", ColumnKind::Float),
        Column::optional("compilation_memory", ColumnKind::BigInteger),
        Column::optional("compilation_shard", ColumnKind::Integer),
        Column::optional(
            "compilation_sandbox_paths",
            ColumnKind::Array(ArrayItem::Text),
        ),
        Column::optional(
            "compilation_sandbox_digests",
            ColumnKind::Array(ArrayItem::Text),
        ),
        Column::optional("evaluation_outcome", ColumnKind::Text),
        Column::generated("evaluation_text", ColumnKind::Array(ArrayItem::Text)),
        Column::generated("evaluation_tries", ColumnKind::Integer),
        Column::optional("execution_time", ColumnKind::Float),
        Column::optional("execution_wall_clock_time", ColumnKind::Float),
        Column::optional("execution_memory", ColumnKind::BigInteger),
        Column::optional("evaluation_shard", ColumnKind::Integer),
        Column::optional(
            "evaluation_sandbox_paths",
            ColumnKind::Array(ArrayItem::Text),
        ),
        Column::optional(
            "evaluation_sandbox_digests",
            ColumnKind::Array(ArrayItem::Text),
        ),
    ],
    relationships: &["executables"],
};

/// The `user_test_executables` table (`src/cms/db/usertest.py:498-550`): unique
/// on `(user_test_id, dataset_id, filename)` and tied to a result by the
/// composite foreign key.
pub const USER_TEST_EXECUTABLE: Declaration = Declaration {
    table: "user_test_executables",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("user_test_id", ColumnKind::Integer),
        Column::reference("dataset_id", ColumnKind::Integer),
        Column::required("filename", ColumnKind::Text),
        Column::required("digest", ColumnKind::Digest),
    ],
    relationships: &["user_test", "dataset", "user_test_result"],
};
