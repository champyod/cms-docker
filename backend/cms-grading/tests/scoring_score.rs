//! One submission result turned into the score row a scoring service writes.

#[path = "scoring_score_helpers.rs"]
mod helpers;

use helpers::{Fixture, SCORED_AT_SECONDS, SUBMISSION_ID};

#[test]
fn sum_scores_two_public_testcases_and_stores_the_exact_documents() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.evaluations[1].execution_time = Some(0.5);
    fixture.evaluations[1].execution_memory = Some(2048);

    let row = fixture.score().expect("both testcases were evaluated");
    let expected = concat!(
        r#"[{"idx":"sample-1","memory":1024,"outcome":"Correct","text":["#,
        r#""Execution completed successfully"],"time":0.25},{"#,
        r#""idx":"sample-2","memory":2048,"outcome":"Partially correct","text":["#,
        r#""Execution completed successfully"],"time":0.5}]"#,
    );

    assert_eq!(row.submission_id, SUBMISSION_ID);
    assert_eq!(row.dataset_id, fixture.dataset.id);
    assert_eq!(row.score, Some(15.0));
    assert_eq!(row.score_details.as_deref(), Some(expected));
    assert_eq!(row.public_score, Some(15.0));
    assert_eq!(row.public_score_details.as_deref(), Some(expected));
    assert_eq!(row.ranking_score_details, Some(Vec::new()));
    assert_eq!(
        row.scored_at,
        Some(cms_db::make_datetime(Some(SCORED_AT_SECONDS)).expect("fixture time is valid"))
    );
}

#[test]
fn group_with_a_private_testcase_stores_an_unscored_public_subtask() {
    let mut fixture = Fixture::new("GroupMin", "[[10,\"sample-*\"]]");
    fixture.testcases[1].is_public = false;
    fixture.evaluations[1].outcome = Some("0.25".to_string());

    let row = fixture.score().expect("both testcases were evaluated");
    let expected = concat!(
        r#"[{"idx":0,"testcases":[{"idx":"sample-1","memory":1024,"#,
        r#""outcome":"Correct","show_in_oi_restricted_feedback":true,"#,
        r#""show_in_restricted_feedback":true,"text":["#,
        r#""Execution completed successfully"],"time":0.25,"time_limit":2.0,"#,
        r#""time_limit_was_exceeded":false},{"idx":"sample-2"}]}]"#,
    );

    assert_eq!(row.score, Some(2.5));
    assert_eq!(row.public_score, Some(0.0));
    assert_eq!(row.public_score_details.as_deref(), Some(expected));
    assert_eq!(row.ranking_score_details, Some(vec!["2.5".to_string()]));
    let details = row.score_details.expect("the administrator has details");
    assert!(details.contains("\"score_fraction\":0.25"), "{details}");
    assert!(details.contains("\"max_score\":10.0"), "{details}");
    assert!(details.contains("\"time_limit\":2.0"), "{details}");
}

#[test]
fn failed_compilation_keeps_the_score_types_zero_and_empty_documents() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.result.evaluation_outcome = None;
    fixture.evaluations.clear();

    let row = fixture
        .score()
        .expect("an unevaluated result has a zero score");

    assert_eq!(row.score, Some(0.0));
    assert_eq!(row.score_details.as_deref(), Some("[]"));
    assert_eq!(row.public_score, Some(0.0));
    assert_eq!(row.public_score_details.as_deref(), Some("[]"));
    assert_eq!(row.ranking_score_details, Some(Vec::new()));
}

#[test]
fn task_precision_rounds_the_subtask_score_stored_in_details() {
    let mut fixture = Fixture::new("GroupMin", "[[1,\"sample-*\"]]");
    fixture.evaluations[1].outcome = Some("0.1235".to_string());

    let row = fixture.score().expect("both testcases were evaluated");

    assert_eq!(row.score, Some(0.1235));
    assert_eq!(row.public_score, Some(0.1235));
    assert_eq!(row.ranking_score_details, Some(vec!["0.1235".to_string()]));
    let details = row.score_details.expect("the administrator has details");
    assert!(details.contains("\"score\":0.12"), "{details}");
    assert!(details.contains("\"score_fraction\":0.1235"), "{details}");
}
