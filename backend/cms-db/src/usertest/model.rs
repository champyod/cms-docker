//! The `user_tests` row and the two named file rows hanging off it.
//!
//! `src/cms/db/usertest.py:38-221`: a user test is one participation's request on
//! one task, carrying the input digest; the files and managers are named rows,
//! each unique on `(user_test_id, filename)`. The names arrive as the column's
//! domain type, so a name the `FILENAME` or `FILENAME_SCHEMA` check would refuse
//! cannot be built, and the digests as [`FileDigest`].

use chrono::NaiveDateTime;

use crate::digest::FileDigest;

use super::name::{Filename, FilenameSchema};

/// A row of `user_tests`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTest {
    /// `user_tests.id`.
    pub id: i32,
    /// `user_tests.participation_id`, the contestant whose request this is.
    pub participation_id: i32,
    /// `user_tests.task_id`, the task the input is run against.
    pub task_id: i32,
    /// `user_tests.timestamp`, when the request arrived.
    pub timestamp: NaiveDateTime,
    /// `user_tests.language`, absent when the test names none.
    pub language: Option<String>,
    /// `user_tests.input`, the digest of the uploaded input.
    pub input: FileDigest,
}

/// A row of `user_test_files`: one uploaded file and its digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTestFile {
    /// `user_test_files.id`.
    pub id: i32,
    /// `user_test_files.user_test_id`.
    pub user_test_id: i32,
    /// `user_test_files.filename`, a `FILENAME_SCHEMA` value.
    pub filename: FilenameSchema,
    /// `user_test_files.digest`.
    pub digest: FileDigest,
}

/// A row of `user_test_managers`: a grader or other file the test needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTestManager {
    /// `user_test_managers.id`.
    pub id: i32,
    /// `user_test_managers.user_test_id`.
    pub user_test_id: i32,
    /// `user_test_managers.filename`, a `FILENAME` value.
    pub filename: Filename,
    /// `user_test_managers.digest`.
    pub digest: FileDigest,
}

/// A row of `user_test_executables`: one file an evaluation produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTestExecutable {
    /// `user_test_executables.id`.
    pub id: i32,
    /// `user_test_executables.user_test_id`, half of the result it belongs to.
    pub user_test_id: i32,
    /// `user_test_executables.dataset_id`, the other half.
    pub dataset_id: i32,
    /// `user_test_executables.filename`, a `FILENAME` value.
    pub filename: Filename,
    /// `user_test_executables.digest`.
    pub digest: FileDigest,
}
