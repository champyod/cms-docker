//! The referential rules of the user-test tables.
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
//! Each collection below is scoped to the user test that owns it, which is what
//! makes the first half of every unique pair a constant rather than a value a
//! caller could forget. [`UserTest::result`] reproduces `get_result`'s refusal
//! to look up a dataset belonging to another task (`usertest.py:121-126`).
//!
//! # Errors
//!
//! Every refusal returns [`ReferentialError`], and none is a warning: the row
//! sets the database would reject are rejected here.

use std::collections::BTreeMap;

use crate::reads::DatasetRecord;

use super::model::{UserTest, UserTestExecutable, UserTestFile, UserTestManager};
use super::result::{ResultKey, UserTestResult};

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

/// The uploaded files of one user test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTestFiles {
    user_test_id: i32,
    rows: BTreeMap<String, UserTestFile>,
}

impl UserTestFiles {
    /// An empty set for one user test.
    #[must_use]
    pub const fn new(user_test_id: i32) -> Self {
        Self {
            user_test_id,
            rows: BTreeMap::new(),
        }
    }

    /// Add a file, refusing a row from another test or a repeated name.
    ///
    /// # Errors
    ///
    /// Returns [`ReferentialError::ForeignUserTest`] when the row names another
    /// user test, and [`ReferentialError::DuplicateFilename`] when the name is
    /// already present.
    pub fn insert(&mut self, file: UserTestFile) -> Result<(), ReferentialError> {
        ensure_owner("user_test_files", self.user_test_id, file.user_test_id)?;
        insert_named(&mut self.rows, "user_test_files", file)
    }

    /// One file by filename.
    #[must_use]
    pub fn get(&self, filename: &str) -> Option<&UserTestFile> {
        self.rows.get(filename)
    }

    /// Every file, in filename order.
    pub fn iter(&self) -> impl Iterator<Item = &UserTestFile> {
        self.rows.values()
    }

    /// How many files the set holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    /// Whether the set holds no file.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}

/// The manager files of one user test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTestManagers {
    user_test_id: i32,
    rows: BTreeMap<String, UserTestManager>,
}

impl UserTestManagers {
    /// An empty set for one user test.
    #[must_use]
    pub const fn new(user_test_id: i32) -> Self {
        Self {
            user_test_id,
            rows: BTreeMap::new(),
        }
    }

    /// Add a manager, refusing a row from another test or a repeated name.
    ///
    /// # Errors
    ///
    /// Returns [`ReferentialError::ForeignUserTest`] when the row names another
    /// user test, and [`ReferentialError::DuplicateFilename`] when the name is
    /// already present.
    pub fn insert(&mut self, manager: UserTestManager) -> Result<(), ReferentialError> {
        ensure_owner(
            "user_test_managers",
            self.user_test_id,
            manager.user_test_id,
        )?;
        insert_named(&mut self.rows, "user_test_managers", manager)
    }

    /// One manager by filename.
    #[must_use]
    pub fn get(&self, filename: &str) -> Option<&UserTestManager> {
        self.rows.get(filename)
    }

    /// How many managers the set holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    /// Whether the set holds no manager.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}

/// The results of one user test, keyed by dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct UserTestResults {
    user_test_id: i32,
    rows: BTreeMap<i32, UserTestResult>,
}

impl UserTestResults {
    /// An empty result set for one user test.
    #[must_use]
    pub const fn new(user_test_id: i32) -> Self {
        Self {
            user_test_id,
            rows: BTreeMap::new(),
        }
    }

    /// Add a result, refusing a row from another test or a repeated dataset.
    ///
    /// # Errors
    ///
    /// Returns [`ReferentialError::ForeignUserTest`] when the row names another
    /// user test, and [`ReferentialError::DuplicateResult`] when the dataset
    /// already has one.
    pub fn insert(&mut self, result: UserTestResult) -> Result<(), ReferentialError> {
        ensure_owner("user_test_results", self.user_test_id, result.user_test_id)?;
        if self.rows.contains_key(&result.dataset_id) {
            return Err(ReferentialError::DuplicateResult {
                user_test_id: self.user_test_id,
                dataset_id: result.dataset_id,
            });
        }
        self.rows.insert(result.dataset_id, result);
        Ok(())
    }

    /// One result by dataset.
    #[must_use]
    pub fn get(&self, dataset_id: i32) -> Option<&UserTestResult> {
        self.rows.get(&dataset_id)
    }

    /// One result by dataset, mutably.
    #[must_use]
    pub fn get_mut(&mut self, dataset_id: i32) -> Option<&mut UserTestResult> {
        self.rows.get_mut(&dataset_id)
    }

    /// How many results the set holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    /// Whether the set holds no result.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// The result for a dataset, created as an empty row when it is absent.
    pub(super) fn entry(&mut self, key: ResultKey) -> &mut UserTestResult {
        self.rows
            .entry(key.dataset_id)
            .or_insert_with(|| UserTestResult::new(key.user_test_id, key.dataset_id))
    }
}

impl UserTest {
    /// The result for `dataset`, or nothing when the pair was never evaluated.
    ///
    /// # Errors
    ///
    /// Returns [`ReferentialError::DatasetFromOtherTask`] when the dataset's task
    /// is not this user test's task, which is the reference's assertion before it
    /// reads the result (`usertest.py:121-126`).
    pub fn result<'a>(
        &self,
        results: &'a UserTestResults,
        dataset: &DatasetRecord,
    ) -> Result<Option<&'a UserTestResult>, ReferentialError> {
        self.ensure_dataset_task(dataset)?;
        Ok(results.get(dataset.id.0))
    }

    /// The result for `dataset`, created when it does not exist yet.
    ///
    /// # Errors
    ///
    /// Returns [`ReferentialError::DatasetFromOtherTask`] under the same rule as
    /// [`UserTest::result`].
    pub fn result_or_create<'a>(
        &self,
        results: &'a mut UserTestResults,
        dataset: &DatasetRecord,
    ) -> Result<&'a mut UserTestResult, ReferentialError> {
        self.ensure_dataset_task(dataset)?;
        Ok(results.entry(ResultKey::new(self.id, dataset.id.0)))
    }

    /// Refuse a dataset from a task other than this user test's.
    fn ensure_dataset_task(&self, dataset: &DatasetRecord) -> Result<(), ReferentialError> {
        if self.task_id != dataset.task_id {
            return Err(ReferentialError::DatasetFromOtherTask {
                test_task_id: self.task_id,
                dataset_task_id: dataset.task_id,
            });
        }
        Ok(())
    }
}

impl UserTestResult {
    /// Attach an executable, refusing one that names another result or a
    /// filename the result already owns.
    ///
    /// # Errors
    ///
    /// Returns [`ReferentialError::ExecutableFromOtherResult`] when the composite
    /// key differs, and [`ReferentialError::DuplicateFilename`] when the name is
    /// already present.
    pub fn attach_executable(
        &mut self,
        executable: UserTestExecutable,
    ) -> Result<(), ReferentialError> {
        if executable.user_test_id != self.user_test_id || executable.dataset_id != self.dataset_id
        {
            return Err(ReferentialError::ExecutableFromOtherResult {
                expected_user_test_id: self.user_test_id,
                expected_dataset_id: self.dataset_id,
                found_user_test_id: executable.user_test_id,
                found_dataset_id: executable.dataset_id,
            });
        }
        insert_named(self.executables_mut(), "user_test_executables", executable)
    }
}

/// Refuse a child row that names a user test other than its set's.
fn ensure_owner(table: &'static str, expected: i32, found: i32) -> Result<(), ReferentialError> {
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
fn insert_named<T>(
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
trait NamedRow<T> {
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
