use std::fs;
use std::path::PathBuf;

use cms_ranking::scoring::{assemble, ScoreMode, Subchange, Submission, TaskMode};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/parity")
        .join(name);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&raw).expect("the fixture is valid json")
}

fn inputs(seed: &Value) -> (Vec<TaskMode>, Vec<Submission>, Vec<Subchange>) {
    let entities = &seed["entities"];
    let tasks = entities["tasks"]
        .as_object()
        .expect("tasks is an object")
        .iter()
        .map(|(key, body)| TaskMode {
            key: key.clone(),
            mode: ScoreMode::from_wire(body["score_mode"].as_str().expect("a mode"))
                .expect("a known mode"),
        })
        .collect();
    let submissions = entities["submissions"]
        .as_object()
        .expect("submissions is an object")
        .iter()
        .map(|(key, body)| Submission {
            key: key.clone(),
            user: body["user"].as_str().expect("a user").to_string(),
            task: body["task"].as_str().expect("a task").to_string(),
            time: body["time"].as_i64().expect("a time"),
        })
        .collect();
    let subchanges = entities["subchanges"]
        .as_object()
        .expect("subchanges is an object")
        .iter()
        .map(|(key, body)| Subchange {
            key: key.clone(),
            submission: body["submission"]
                .as_str()
                .expect("a submission")
                .to_string(),
            time: body["time"].as_i64().expect("a time"),
            score: body["score"].as_f64(),
            token: body["token"].as_bool(),
            extra: body["extra"]
                .as_array()
                .map(|values| values.iter().filter_map(Value::as_f64).collect()),
        })
        .collect();
    (tasks, submissions, subchanges)
}

/// The parity gate for Slice 3's scoring: the expected values are the output of
/// the shipping Python scorer (see score_oracle.py), not a reading of it.
#[test]
fn scores_and_history_match_the_python_scorer() {
    let seed = fixture("seed.json");
    let oracle = fixture("scoring-oracle.json");
    let (tasks, submissions, subchanges) = inputs(&seed);
    let ledger = assemble(&tasks, &submissions, &subchanges).expect("the fixture modes are known");
    assert_eq!(ledger.skipped_subchanges(), 0);

    // Compared as numbers rather than as JSON values: the fixture records what the
    // Python scorer printed, and a JSON round trip is free to spell 100.0 as 100.
    let expected_scores = oracle["scores"].as_object().expect("an object of rows");
    for (user, per_task) in ledger.scores() {
        let row = expected_scores
            .get(user)
            .unwrap_or_else(|| panic!("the oracle has no row for {user}"))
            .as_object()
            .expect("a row of task scores");
        assert_eq!(
            per_task.len(),
            row.len(),
            "{user} has a different task count"
        );
        for (task, value) in per_task {
            let expected = row
                .get(task)
                .unwrap_or_else(|| panic!("the oracle has no score for {user}/{task}"))
                .as_f64()
                .expect("a number");
            assert!(
                (value - expected).abs() < f64::EPSILON,
                "{user}/{task}: computed {value}, oracle {expected}"
            );
        }
    }

    let expected_history = oracle["history"].as_array().expect("an array of entries");
    assert_eq!(ledger.history().len(), expected_history.len());
    for (computed, expected) in ledger.history().iter().zip(expected_history) {
        let entry = expected.as_array().expect("an entry");
        assert_eq!(computed.0, entry[0].as_str().expect("a user"));
        assert_eq!(computed.1, entry[1].as_str().expect("a task"));
        assert_eq!(computed.2, entry[2].as_i64().expect("a time"));
        let score = entry[3].as_f64().expect("a score");
        assert!(
            (computed.3 - score).abs() < f64::EPSILON,
            "history score {} != oracle {score}",
            computed.3
        );
    }
}

/// /sublist serves every submission of a user (not just the best), each with its own
/// score, token and extra, ordered by (task, time) the way the Python handler sorted.
#[test]
fn the_sublist_carries_every_submission_of_a_user() {
    let seed = fixture("seed.json");
    let (tasks, submissions, subchanges) = inputs(&seed);
    let ledger = assemble(&tasks, &submissions, &subchanges).expect("known modes");

    let u0 = ledger.sublist("u0");
    assert_eq!(u0.len(), 2, "u0 has two submissions in the seed");
    assert_eq!(
        (
            u0[0].task.as_str(),
            u0[0].time,
            u0[0].key.as_str(),
            u0[0].score,
        ),
        ("t0", 1700001000, "s0", 50.0)
    );
    assert_eq!((u0[1].key.as_str(), u0[1].score), ("s1", 100.0));

    let tasks_of_u1: Vec<&str> = ledger
        .sublist("u1")
        .into_iter()
        .map(|entry| entry.task.as_str())
        .collect();
    assert_eq!(tasks_of_u1, vec!["t0", "t1"]);

    assert!(ledger.sublist("nobody").is_empty());
}

/// Guards the one place the two Python helpers differ: the max mode keeps a
/// negative score, while a released query is clamped at zero.
#[test]
fn a_negative_score_survives_max_but_not_a_released_query() {
    let tasks = vec![
        TaskMode {
            key: "t".to_string(),
            mode: ScoreMode::Max,
        },
        TaskMode {
            key: "u".to_string(),
            mode: ScoreMode::MaxTokenedLast,
        },
    ];
    let submissions = vec![
        Submission {
            key: "s".to_string(),
            user: "a".to_string(),
            task: "t".to_string(),
            time: 1,
        },
        Submission {
            key: "r".to_string(),
            user: "b".to_string(),
            task: "u".to_string(),
            time: 1,
        },
    ];
    let subchanges = vec![
        Subchange {
            key: "c".to_string(),
            submission: "s".to_string(),
            time: 2,
            score: Some(-5.0),
            token: None,
            extra: None,
        },
        Subchange {
            key: "d".to_string(),
            submission: "r".to_string(),
            time: 2,
            score: Some(-7.0),
            token: Some(true),
            extra: None,
        },
    ];
    let ledger = assemble(&tasks, &submissions, &subchanges).expect("known modes");
    // Only the max pair records anything: the tokened pair computes 0.0 before and
    // after its change, and a score that does not move writes no history.
    assert_eq!(ledger.history().len(), 1);
    assert_eq!(ledger.history()[0].0, "a");
    assert_eq!(
        ledger.history()[0].3,
        -5.0,
        "the max mode keeps a negative score"
    );
    assert!(
        !ledger.scores().contains_key("b"),
        "a released set clamped to 0.0 is not above zero, so it stays off the board"
    );
}
