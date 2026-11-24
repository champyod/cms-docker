//! The exact JSON documents stored behind private and public scores.
//!
//! The expected documents are transcribed from Python's `Sum` and
//! `ScoreTypeGroup.compute_score`: field names, nulls, nesting and text order are
//! storage contracts rather than presentation choices.

use cms_grading::scoretypes::{Row, ScoreDetails, Scored, Subtask, SumRow, Testcase};
use serde_json::json;

#[test]
fn a_sum_document_holds_shown_fields_and_only_the_hidden_index() {
    let shown = SumRow::Shown {
        index: "0_0".to_owned(),
        outcome: "Correct".to_owned(),
        text: vec!["first".to_owned(), "second".to_owned()],
        time: Some(0.25),
        memory: Some(1024),
    };
    let hidden = SumRow::Hidden {
        index: "0_1".to_owned(),
    };
    let expected = json!([
        {
            "idx": "0_0",
            "outcome": "Correct",
            "text": ["first", "second"],
            "time": 0.25,
            "memory": 1024
        },
        {"idx": "0_1"}
    ]);
    let scored = scored(
        ScoreDetails::Testcases(vec![shown.clone(), hidden.clone()]),
        ScoreDetails::Testcases(vec![shown, hidden]),
    );

    assert_eq!(scored.details.to_json(), expected);
    assert_eq!(scored.details_json(), expected);
    assert_eq!(scored.public_details_json(), expected);
}

#[test]
fn a_group_private_document_holds_the_scored_subtask_and_every_testcase_field() {
    let scored = group_private();
    let expected = json!([
        {
            "idx": 1,
            "score_fraction": 0.5,
            "score": 15.25,
            "max_score": 30.5,
            "testcases": [
                {
                    "idx": "1_0",
                    "outcome": "Partially correct",
                    "text": ["sentence", "argument"],
                    "time": 0.5,
                    "time_limit": 1.0,
                    "time_limit_was_exceeded": true,
                    "memory": 100,
                    "show_in_restricted_feedback": true,
                    "show_in_oi_restricted_feedback": false
                }
            ]
        }
    ]);

    assert_eq!(scored.details.to_json(), expected);
    assert_eq!(scored.details_json(), expected);
}

#[test]
fn a_group_public_document_holds_scored_and_unscored_subtasks() {
    let scored_subtask = Subtask::Scored {
        index: 0,
        score_fraction: 1.0,
        score: 10.5,
        max_score: 10.5,
        testcases: vec![Row::Shown(testcase("0_0"))],
    };
    let unscored_subtask = Subtask::Unscored {
        index: 1,
        testcases: vec![
            Row::Shown(testcase("1_0")),
            Row::Hidden {
                index: "1_1".to_owned(),
            },
        ],
    };
    let details = ScoreDetails::Subtasks(vec![scored_subtask, unscored_subtask]);
    let scored = scored(details.clone(), details);
    let expected = json!([
        {
            "idx": 0,
            "score_fraction": 1.0,
            "score": 10.5,
            "max_score": 10.5,
            "testcases": [testcase_json("0_0")]
        },
        {
            "idx": 1,
            "testcases": [testcase_json("1_0"), {"idx": "1_1"}]
        }
    ]);

    assert_eq!(scored.public_details.to_json(), expected);
    assert_eq!(scored.public_details_json(), expected);
}

#[test]
fn empty_testcases_and_subtasks_documents_are_arrays() {
    let testcases = ScoreDetails::Testcases(Vec::new());
    let subtasks = ScoreDetails::Subtasks(Vec::new());
    let scored = scored(testcases.clone(), subtasks.clone());

    assert_eq!(testcases.to_json(), json!([]));
    assert_eq!(subtasks.to_json(), json!([]));
    assert_eq!(scored.details_json(), json!([]));
    assert_eq!(scored.public_details_json(), json!([]));
}

#[test]
fn absent_sum_time_and_memory_remain_null() {
    let sum = ScoreDetails::Testcases(vec![SumRow::Shown {
        index: "0_0".to_owned(),
        outcome: "Not correct".to_owned(),
        text: vec!["no measurements".to_owned()],
        time: None,
        memory: None,
    }]);
    assert_eq!(
        sum.to_json(),
        json!([{
            "idx": "0_0",
            "outcome": "Not correct",
            "text": ["no measurements"],
            "time": null,
            "memory": null
        }])
    );
}

#[test]
fn absent_group_time_time_limit_and_memory_remain_null() {
    let mut testcase = testcase("0_0");
    testcase.time = None;
    testcase.time_limit = None;
    testcase.memory = None;
    let group = ScoreDetails::Subtasks(vec![Subtask::Unscored {
        index: 0,
        testcases: vec![Row::Shown(testcase)],
    }]);
    assert_eq!(
        group.to_json(),
        json!([{
            "idx": 0,
            "testcases": [{
                "idx": "0_0",
                "outcome": "Partially correct",
                "text": ["sentence", "argument"],
                "time": null,
                "time_limit": null,
                "time_limit_was_exceeded": true,
                "memory": null,
                "show_in_restricted_feedback": true,
                "show_in_oi_restricted_feedback": false
            }]
        }])
    );
}

fn group_private() -> Scored {
    let details = ScoreDetails::Subtasks(vec![Subtask::Scored {
        index: 1,
        score_fraction: 0.5,
        score: 15.25,
        max_score: 30.5,
        testcases: vec![Row::Shown(testcase("1_0"))],
    }]);
    scored(details, ScoreDetails::Subtasks(Vec::new()))
}

fn testcase(index: &str) -> Testcase {
    Testcase {
        index: index.to_owned(),
        outcome: "Partially correct".to_owned(),
        text: vec!["sentence".to_owned(), "argument".to_owned()],
        time: Some(0.5),
        time_limit: Some(1.0),
        time_limit_was_exceeded: true,
        memory: Some(100),
        show_in_restricted_feedback: true,
        show_in_oi_restricted_feedback: false,
    }
}

fn testcase_json(index: &str) -> serde_json::Value {
    json!({
        "idx": index,
        "outcome": "Partially correct",
        "text": ["sentence", "argument"],
        "time": 0.5,
        "time_limit": 1.0,
        "time_limit_was_exceeded": true,
        "memory": 100,
        "show_in_restricted_feedback": true,
        "show_in_oi_restricted_feedback": false
    })
}

fn scored(details: ScoreDetails, public_details: ScoreDetails) -> Scored {
    Scored {
        score: 0.0,
        details,
        public_score: 0.0,
        public_details,
        ranking_details: Vec::new(),
    }
}
