//! The refusals every user-test child row shares, and the map insert behind
//! them.
//!
//! `src/cms/db/usertest.py` states three uniqueness rules and one composite
//! foreign key:
//!
//! - `user_test_files` and `user_test_managers` are unique on
//!   `(user_test_id, filename)` (`usertest.py:160-162,195-197`);
//! - `user_test_results` is unique on `(user_test_id, dataset_id)`
//!   (`usertest.py:242-244`);
//! - `user_test_executables` carries `ForeignKeyConstraint((user_test_id,
//!   dataset_id), UserTestResult.(user_test_id, dataset_id))` plus a unique on
//!   the triple (`usertest.py:504-510`).
//!
//! Each collection is scoped to the user test that owns it, which makes the
//! first half of every unique pair a constant rather than a value a caller could
//! forget. The collections live in `files` and `results`; this module holds the
//! error they share and the insert that refuses a repeated name.

use std::collections::BTreeMap;

use super::model::{UserTestExecutable, UserTestFile, UserTestManager};

/// Why a child row cannot join the set it names.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReferentialError {
    /// A row names a user test other than the set's own.
    #[error("{table} row belongs to user test {found}, not {expected}")]
    ForeignUserTest {
        /// The table the row would join.
        table: &'static str,
        /// The user test owning the set.
        expected: i32,
        /// The user test the row names.
        found: i32,
    },
    /// The unique `(user_test_id, filename)` pair already holds a row.
    #[error("{table} already has a row named {filename:?}")]
    DuplicateFilename {
        /// The table the row would join.
        table: &'static str,
        /// The filename that repeats.
        filename: String,
    },
    /// The unique `(user_test_id, dataset_id)` pair already holds a result.
    #[error("user {user_test_id} already has a result for dataset {dataset_id}")]
    DuplicateResult {
        /// The user test half of the key.
        user_test_id: i32,
        /// The dataset half of the key.
        dataset_id: i32,
    },
    /// An executable names a result other than the one it is attached to.
    #[error(
        "an executable for user test {found_user_test_id} and dataset {found_dataset_id} \
         cannot join the result for user test {expected_user_test_id} and dataset \
         {expected_dataset_id}"
    )]
    ExecutableFromOtherResult {
        /// The result's user test.
        expected_user_test_id: i32,
        /// The result's dataset.
        expected_dataset_id: i32,
        /// The executable's user test.
        found_user_test_id: i32,
        /// The executable's dataset.
        found_dataset_id: i32,
    },
    /// A dataset belongs to a task the user test was not requested on.
    #[error("dataset belongs to task {dataset_task_id}, not the user test's task {test_task_id}")]
    DatasetFromOtherTask {
        /// The user test's task.
        test_task_id: i32,
        /// The dataset's task.
        dataset_task_id: i32,
    },
}

/// Refuse a child row that names a user test other than its set's.
pub(super) fn ensure_owner(
    table: &'static str,
    expected: i32,
    found: i32,
) -> Result<(), ReferentialError> {
    if expected != found {
        return Err(ReferentialError::ForeignUserTest {
            table,
            expected,
            found,
        });
    }
    Ok(())
}

/// Insert a named row, refusing a filename the map already holds.
pub(super) fn insert_named<T>(
    rows: &mut BTreeMap<String, T>,
    table: &'static str,
    row: impl NamedRow<T>,
) -> Result<(), ReferentialError> {
    let (filename, row) = row.into_named();
    if rows.contains_key(&filename) {
        return Err(ReferentialError::DuplicateFilename { table, filename });
    }
    rows.insert(filename, row);
    Ok(())
}

/// A row that carries the filename it is filed under.
pub(super) trait NamedRow<T> {
    /// Split the row into its filename and its value.
    fn into_named(self) -> (String, T);
}

impl NamedRow<UserTestFile> for UserTestFile {
    fn into_named(self) -> (String, UserTestFile) {
        (self.filename.as_str().to_string(), self)
    }
}

impl NamedRow<UserTestManager> for UserTestManager {
    fn into_named(self) -> (String, UserTestManager) {
        (self.filename.as_str().to_string(), self)
    }
}

impl NamedRow<UserTestExecutable> for UserTestExecutable {
    fn into_named(self) -> (String, UserTestExecutable) {
        (self.filename.as_str().to_string(), self)
    }
}
