//! The referential rules of the user-test tables, refusal by refusal.
//!
//! Each set is scoped to one user test, which is the first half of every unique
//! pair the reference declares. The tests cover a repeated filename, a row from
//! another test, a repeated result key, an executable that names another result,
//! and a dataset from a task the user test was not requested on.

use chrono::NaiveDate;
use cms_db::{
    DatasetId, DatasetRecord, FileDigest, Filename, FilenameSchema, ReferentialError, UserTest,
    UserTestExecutable, UserTestFile, UserTestFiles, UserTestManager, UserTestManagers,
    UserTestResult, UserTestResults,
};

/// Forty lowercase hex characters, which every `DIGEST` column accepts.
const DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

/// The user test every fixture belongs to.
const USER_TEST: i32 = 7;

/// The task that user test was requested on.
const TASK: i32 = 42;

fn digest() -> FileDigest {
    DIGEST.parse().expect("fixture digest is valid")
}

fn schema(value: &str) -> FilenameSchema {
    FilenameSchema::parse(value).expect("fixture name is a schema")
}

fn filename(value: &str) -> Filename {
    Filename::parse(value).expect("fixture name is a filename")
}

fn user_test() -> UserTest {
    UserTest {
        id: USER_TEST,
        participation_id: 3,
        task_id: TASK,
        timestamp: NaiveDate::from_ymd_opt(2026, 11, 22)
            .and_then(|date| date.and_hms_opt(10, 0, 0))
            .expect("fixture time is valid"),
        language: Some("cpp".to_string()),
        input: digest(),
    }
}

fn file(user_test_id: i32, name: &str) -> UserTestFile {
    UserTestFile {
        id: 1,
        user_test_id,
        filename: schema(name),
        digest: digest(),
    }
}

fn manager(user_test_id: i32, name: &str) -> UserTestManager {
    UserTestManager {
        id: 1,
        user_test_id,
        filename: filename(name),
        digest: digest(),
    }
}

fn executable(user_test_id: i32, dataset_id: i32, name: &str) -> UserTestExecutable {
    UserTestExecutable {
        id: 1,
        user_test_id,
        dataset_id,
        filename: filename(name),
        digest: digest(),
    }
}

fn dataset(id: i32, task_id: i32) -> DatasetRecord {
    DatasetRecord {
        id: DatasetId(id),
        task_id,
        task_type: "Batch".to_string(),
        time_limit: Some(1.0),
        memory_limit: None,
        is_active: true,
    }
}

#[test]
fn a_file_set_holds_distinct_names() {
    let mut files = UserTestFiles::new(USER_TEST);

    files
        .insert(file(USER_TEST, "input.%l"))
        .expect("first file");
    files
        .insert(file(USER_TEST, "extra.%l"))
        .expect("second file");

    assert_eq!(files.len(), 2);
    assert!(files.get("input.%l").is_some());
}

#[test]
fn a_repeated_filename_is_refused_by_the_file_set() {
    let mut files = UserTestFiles::new(USER_TEST);
    files
        .insert(file(USER_TEST, "input.%l"))
        .expect("first file");

    assert_eq!(
        files.insert(file(USER_TEST, "input.%l")),
        Err(ReferentialError::DuplicateFilename {
            table: "user_test_files",
            filename: "input.%l".to_string(),
        })
    );
}

#[test]
fn a_file_from_another_user_test_is_refused() {
    let mut files = UserTestFiles::new(USER_TEST);

    assert_eq!(
        files.insert(file(USER_TEST + 1, "input.%l")),
        Err(ReferentialError::ForeignUserTest {
            table: "user_test_files",
            expected: USER_TEST,
            found: USER_TEST + 1,
        })
    );
}

#[test]
fn a_repeated_manager_filename_is_refused() {
    let mut managers = UserTestManagers::new(USER_TEST);
    managers
        .insert(manager(USER_TEST, "grader"))
        .expect("first manager");

    assert_eq!(
        managers.insert(manager(USER_TEST, "grader")),
        Err(ReferentialError::DuplicateFilename {
            table: "user_test_managers",
            filename: "grader".to_string(),
        })
    );
}

#[test]
fn a_manager_from_another_user_test_is_refused() {
    let mut managers = UserTestManagers::new(USER_TEST);

    assert_eq!(
        managers.insert(manager(USER_TEST + 1, "grader")),
        Err(ReferentialError::ForeignUserTest {
            table: "user_test_managers",
            expected: USER_TEST,
            found: USER_TEST + 1,
        })
    );
}

#[test]
fn a_repeated_result_key_is_refused() {
    let mut results = UserTestResults::new(USER_TEST);
    results
        .insert(UserTestResult::new(USER_TEST, 9))
        .expect("first result");

    assert_eq!(
        results.insert(UserTestResult::new(USER_TEST, 9)),
        Err(ReferentialError::DuplicateResult {
            user_test_id: USER_TEST,
            dataset_id: 9,
        })
    );
}

#[test]
fn a_result_from_another_user_test_is_refused() {
    let mut results = UserTestResults::new(USER_TEST);

    assert_eq!(
        results.insert(UserTestResult::new(USER_TEST + 1, 9)),
        Err(ReferentialError::ForeignUserTest {
            table: "user_test_results",
            expected: USER_TEST,
            found: USER_TEST + 1,
        })
    );
}

#[test]
fn an_executable_joins_the_result_it_names() {
    let mut result = UserTestResult::new(USER_TEST, 9);

    result
        .attach_executable(executable(USER_TEST, 9, "solution"))
        .expect("matching executable");

    assert!(result.executable("solution").is_some());
}

#[test]
fn an_executable_for_another_result_is_refused() {
    let mut result = UserTestResult::new(USER_TEST, 9);

    assert_eq!(
        result.attach_executable(executable(USER_TEST, 10, "solution")),
        Err(ReferentialError::ExecutableFromOtherResult {
            expected_user_test_id: USER_TEST,
            expected_dataset_id: 9,
            found_user_test_id: USER_TEST,
            found_dataset_id: 10,
        })
    );
    assert!(result.executable("solution").is_none());
}

#[test]
fn an_executable_with_a_repeated_filename_is_refused() {
    let mut result = UserTestResult::new(USER_TEST, 9);
    result
        .attach_executable(executable(USER_TEST, 9, "solution"))
        .expect("first executable");

    assert_eq!(
        result.attach_executable(executable(USER_TEST, 9, "solution")),
        Err(ReferentialError::DuplicateFilename {
            table: "user_test_executables",
            filename: "solution".to_string(),
        })
    );
}

#[test]
fn a_result_is_absent_until_it_is_written() {
    let test = user_test();
    let results = UserTestResults::new(USER_TEST);

    assert_eq!(test.result(&results, &dataset(9, TASK)), Ok(None));
}

#[test]
fn a_written_result_is_read_back_by_dataset() {
    let test = user_test();
    let mut results = UserTestResults::new(USER_TEST);
    results
        .insert(UserTestResult::new(USER_TEST, 9))
        .expect("result row");

    let found = test.result(&results, &dataset(9, TASK)).expect("same task");

    assert!(found.is_some());
}

#[test]
fn a_dataset_from_another_task_is_refused() {
    let test = user_test();
    let results = UserTestResults::new(USER_TEST);

    assert_eq!(
        test.result(&results, &dataset(9, TASK + 1)),
        Err(ReferentialError::DatasetFromOtherTask {
            test_task_id: TASK,
            dataset_task_id: TASK + 1,
        })
    );
}

#[test]
fn getting_or_creating_a_result_writes_it_once() {
    let test = user_test();
    let mut results = UserTestResults::new(USER_TEST);
    let target = dataset(9, TASK);

    let created = test
        .result_or_create(&mut results, &target)
        .expect("same task");
    created.set_compilation_outcome(true);

    let again = test
        .result_or_create(&mut results, &target)
        .expect("same task");
    let succeeded = again.compilation_succeeded();

    assert_eq!(results.len(), 1);
    assert!(succeeded);
}
