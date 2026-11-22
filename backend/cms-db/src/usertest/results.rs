//! The results of one user test, and the executable rule under a result.
//!
//! `user_test_results` is unique on `(user_test_id, dataset_id)`
//! (`src/cms/db/usertest.py:242-244`), so the set is scoped to its user test.
//! `UserTest.get_result` refuses a dataset from another task before it reads a
//! row (`usertest.py:121-126`), and `UserTestExecutable` is tied to its result by
//! the composite foreign key at `usertest.py:504-510`.

use std::collections::BTreeMap;

use crate::reads::DatasetRecord;

use super::model::{UserTest, UserTestExecutable};
use super::referential::{ensure_owner, insert_named, ReferentialError};
use super::result::{ResultKey, UserTestResult};

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
