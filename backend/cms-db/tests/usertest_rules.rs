//! The named file sets of one user test, refusal by refusal.
//!
//! Each set is scoped to one user test, which is the first half of the
//! `(user_test_id, filename)` unique pair the reference declares.

use cms_db::{ReferentialError, UserTestFiles, UserTestManagers};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/usertest_fixture.rs"]
mod usertest_fixture;

use usertest_fixture::{file, manager, USER_TEST};

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
