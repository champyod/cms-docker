//! The result set, the executable rule under a result, and the task guard.
//!
//! `user_test_results` is unique on `(user_test_id, dataset_id)`, an executable
//! names its result by the same composite key, and `get_result` refuses a
//! dataset from a task the user test was not requested on.

use cms_db::{ReferentialError, UserTestResult, UserTestResults};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/usertest_fixture.rs"]
mod usertest_fixture;

use usertest_fixture::{dataset, executable, user_test, TASK, USER_TEST};

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
