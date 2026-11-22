//! The two named file sets of one user test.
//!
//! `user_test_files` and `user_test_managers` are both unique on
//! `(user_test_id, filename)` (`src/cms/db/usertest.py:160-162,195-197`), so a
//! set is scoped to its user test and refuses a repeated name.

use std::collections::BTreeMap;

use super::model::{UserTestFile, UserTestManager};
use super::referential::{ensure_owner, insert_named, ReferentialError};

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
