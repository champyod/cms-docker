//! The `Task` model's declaration, its language fallback, and the quota `tokening.py:52-176` computes.

use cms_db::{Codename, FeedbackLevel, ScoreMode, Task, TokenMode, TokenRules, TASK};

/// A task row carrying only what the language fallback reads.
fn task_with(allowed: Option<Vec<String>>) -> Task {
    Task {
        id: 7,
        name: Codename::parse("greeting").expect("a codename"),
        title: "Greeting".to_string(),
        submission_format: vec!["%l".to_string()],
        primary_statements: Vec::new(),
        allowed_languages: allowed,
        token: TokenRules::disabled(),
        max_submission_number: None,
        max_user_test_number: None,
        min_submission_interval: None,
        min_user_test_interval: None,
        evaluation_throttle_delay_s: None,
        feedback_level: FeedbackLevel::Restricted,
        score_precision: 0,
        score_mode: ScoreMode::MaxTokenedLast,
        active_dataset_id: None,
    }
}

/// The contests a task is offered in, each with its own languages.
fn contests(languages: &[&[&str]]) -> Vec<Vec<String>> {
    languages
        .iter()
        .map(|contest| contest.iter().map(|code| (*code).to_string()).collect())
        .collect()
}

#[test]
fn the_declaration_describes_the_task_table_and_its_pointer() {
    TASK.validate()
        .expect("the declaration must describe a table");

    assert_eq!(TASK.table, "tasks");
    assert_eq!(TASK.columns.len(), 22);
    assert!(TASK.columns[0].primary_key);
    let pointer = TASK
        .columns
        .iter()
        .find(|column| column.name == "active_dataset_id")
        .expect("the active dataset is a column");
    assert!(pointer.foreign_key && pointer.nullable);
    // The pointer is identity, not a value: the reference's attribute set skips it.
    assert!(!TASK
        .value_columns()
        .any(|column| column.name == "active_dataset_id"));
}

#[test]
fn a_task_with_its_own_languages_ignores_the_contests_it_is_offered_in() {
    let task = task_with(Some(vec!["rust".to_string()]));

    assert_eq!(
        task.get_allowed_languages(&contests(&[&["cpp"], &["python"]])),
        Some(vec!["rust".to_string()])
    );
}

#[test]
fn a_task_without_languages_takes_them_from_its_only_contest() {
    let task = task_with(None);

    assert_eq!(
        task.get_allowed_languages(&contests(&[&["cpp", "python"]])),
        Some(vec!["cpp".to_string(), "python".to_string()])
    );
}

#[test]
fn a_task_shared_by_several_contests_has_no_language_fallback() {
    let task = task_with(None);

    assert_eq!(
        task.get_allowed_languages(&contests(&[&["cpp"], &["python"]])),
        None
    );
    assert_eq!(task.get_allowed_languages(&contests(&[])), None);
}

#[test]
fn a_column_value_the_enum_does_not_declare_is_unreadable() {
    assert_eq!(TokenMode::parse("finite"), Some(TokenMode::Finite));
    assert_eq!(TokenMode::parse("mixed"), None);
    assert_eq!(ScoreMode::parse("max_tokened_last_mixed"), None);
    assert_eq!(
        FeedbackLevel::parse("oi_restricted"),
        Some(FeedbackLevel::OiRestricted)
    );
    assert_eq!(FeedbackLevel::parse("verbose"), None);
}
