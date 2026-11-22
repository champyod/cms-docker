//! The user-test declarations, the two name domains, and the derived status.
//!
//! Every fixture is a value the column holds: a `FILENAME_SCHEMA` for an input
//! file, forty lowercase hex for a digest, and a fresh result row.

use cms_db::{
    Filename, FilenameError, FilenameSchema, UserTestResult, UserTestStatus, USER_TEST,
    USER_TEST_EXECUTABLE, USER_TEST_FILE, USER_TEST_MANAGER, USER_TEST_RESULT,
};

/// Forty lowercase hex characters, which every `DIGEST` column accepts.
const DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn every_declaration_describes_its_table() {
    for declaration in [
        USER_TEST,
        USER_TEST_FILE,
        USER_TEST_MANAGER,
        USER_TEST_RESULT,
        USER_TEST_EXECUTABLE,
    ] {
        assert_eq!(declaration.validate(), Ok(()), "{}", declaration.table);
    }
}

#[test]
fn the_declarations_carry_the_columns_and_skip_the_keys() {
    assert_eq!(USER_TEST.columns.len(), 6);
    assert_eq!(USER_TEST.value_columns().count(), 3);
    assert_eq!(USER_TEST_FILE.columns.len(), 4);
    assert_eq!(USER_TEST_FILE.value_columns().count(), 2);
    assert_eq!(USER_TEST_MANAGER.columns.len(), 4);
    assert_eq!(USER_TEST_RESULT.columns.len(), 23);
    assert_eq!(USER_TEST_RESULT.value_columns().count(), 21);
    assert_eq!(USER_TEST_EXECUTABLE.columns.len(), 5);
    assert_eq!(USER_TEST_EXECUTABLE.value_columns().count(), 2);
}

#[test]
fn a_filename_accepts_the_domain_alphabet() {
    for value in ["a", "solution.cpp", "a-b_c.1", ".hidden"] {
        assert_eq!(
            Filename::parse(value).map(|name| name.as_str().to_string()),
            Ok(value.to_string()),
            "{value} should be a filename"
        );
    }
}

#[test]
fn a_filename_refuses_the_empty_and_directory_names() {
    assert_eq!(Filename::parse(""), Err(FilenameError::Empty));
    assert_eq!(Filename::parse("."), Err(FilenameError::DirectoryEntry));
    assert_eq!(Filename::parse(".."), Err(FilenameError::DirectoryEntry));
}

#[test]
fn a_filename_refuses_a_character_outside_the_alphabet() {
    assert_eq!(
        Filename::parse("a/b"),
        Err(FilenameError::ForbiddenCharacter { character: '/' })
    );
    assert_eq!(
        Filename::parse("é"),
        Err(FilenameError::ForbiddenCharacter { character: 'é' })
    );
}

#[test]
fn a_filename_schema_accepts_an_optional_language_suffix() {
    for value in ["solution.%l", "archive.tar.%l", "solution.cpp"] {
        assert_eq!(
            FilenameSchema::parse(value).map(|name| name.as_str().to_string()),
            Ok(value.to_string()),
            "{value} should be a filename schema"
        );
    }
}

#[test]
fn a_filename_schema_needs_a_base_before_the_placeholder() {
    assert_eq!(FilenameSchema::parse(".%l"), Err(FilenameError::Empty));
}

#[test]
fn a_filename_schema_refuses_a_percent_outside_the_placeholder() {
    assert_eq!(
        FilenameSchema::parse("sol%ution"),
        Err(FilenameError::ForbiddenCharacter { character: '%' })
    );
}

#[test]
fn a_fresh_result_is_compiling() {
    let result = UserTestResult::new(7, 3);

    assert_eq!(result.status(), UserTestStatus::Compiling);
    assert_eq!(result.status().code(), 1);
    assert!(!result.compiled() && !result.evaluated());
}

#[test]
fn a_failed_compilation_is_final() {
    let mut result = UserTestResult::new(7, 3);
    result.set_compilation_outcome(false);

    assert_eq!(result.status(), UserTestStatus::CompilationFailed);
    assert_eq!(result.status().code(), 2);
    assert!(result.compiled() && result.compilation_failed());
}

#[test]
fn a_successful_compilation_is_evaluating() {
    let mut result = UserTestResult::new(7, 3);
    result.set_compilation_outcome(true);

    assert_eq!(result.status(), UserTestStatus::Evaluating);
    assert_eq!(result.status().code(), 3);
    assert!(result.compilation_succeeded());
}

#[test]
fn an_evaluated_result_is_evaluated() {
    let mut result = UserTestResult::new(7, 3);
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();

    assert_eq!(result.status(), UserTestStatus::Evaluated);
    assert_eq!(result.status().code(), 4);
}

#[test]
fn invalidating_evaluation_keeps_the_compilation() {
    let mut result = UserTestResult::new(7, 3);
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();
    result.evaluation_tries = 2;
    result.output = Some(DIGEST.parse().expect("fixture digest is valid"));

    result.invalidate_evaluation();

    assert!(result.compilation_succeeded());
    assert_eq!(result.status(), UserTestStatus::Evaluating);
    assert_eq!(result.evaluation_tries, 0);
    assert!(result.output.is_none());
}

#[test]
fn invalidating_compilation_clears_both_halves() {
    let mut result = UserTestResult::new(7, 3);
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();
    result.compilation_tries = 1;
    result.compilation_text = vec!["%s".to_string()];

    result.invalidate_compilation();

    assert_eq!(result.status(), UserTestStatus::Compiling);
    assert_eq!(result.compilation_tries, 0);
    assert!(result.compilation_text.is_empty());
    assert!(result.evaluation_outcome.is_none());
}

#[test]
fn a_result_key_is_the_pair_of_its_own_columns() {
    let result = UserTestResult::new(7, 3);

    assert_eq!(result.key().user_test_id, 7);
    assert_eq!(result.key().dataset_id, 3);
}
