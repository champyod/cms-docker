//! The batches judging writes are grouped into, and the audit rows each one
//! must carry.
//!
//! Every fixture stands for nothing: synthetic ids, a digest the `DIGEST` domain
//! allows, and the one value each outcome column accepts. No connection is
//! opened, and no check reads a clock or draws a random.

use cms_db::{
    group_by_object, AuditRow, CompilationOutcome, EvaluationRow, ExecutableRow, ObjectWrite,
    OperationType, ResultRow, RowState, ScoreRow, WriteError,
};

/// Synthetic ids, standing for nothing outside this file.
const SUBMISSION_ID: i32 = 41;
const OTHER_SUBMISSION_ID: i32 = 42;
const DATASET_ID: i32 = 9;
const TESTCASE_ID: i32 = 3;
const OTHER_TESTCASE_ID: i32 = 4;
/// The admin a fixture change is attributed to.
const ACTOR_ID: i32 = 7;
/// Forty lowercase hex characters, which is what `executables.digest` holds.
const DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";
/// A `jsonb` score-details document, carried as the text the statement casts.
const SCORE_DETAILS: &str = "{\"percent\": 100.0}";
/// The grader output a `text` array holds.
const GRADER_TEXT: &str = "Output is correct";

/// The result row of an object whose compilation succeeded once.
fn result_row() -> ResultRow {
    ResultRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        compilation_outcome: Some(CompilationOutcome::Ok),
        compilation_text: vec![GRADER_TEXT.to_string()],
        compilation_tries: 1,
        compilation_stdout: None,
        compilation_stderr: None,
        compilation_time: Some(0.5),
        compilation_wall_clock_time: Some(0.6),
        compilation_memory: Some(1024),
        compilation_shard: Some(0),
        compilation_sandbox_paths: None,
        compilation_sandbox_digests: Some(vec![DIGEST.to_string()]),
        evaluation_outcome: None,
        evaluation_tries: 0,
    }
}

/// One testcase run.
fn evaluation_row(testcase_id: i32) -> EvaluationRow {
    EvaluationRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        testcase_id,
        outcome: Some("1.0".to_string()),
        text: vec![GRADER_TEXT.to_string()],
        admin_text: None,
        execution_time: Some(0.1),
        execution_wall_clock_time: Some(0.2),
        execution_memory: Some(2048),
        evaluation_shard: Some(0),
        evaluation_sandbox_paths: None,
        evaluation_sandbox_digests: None,
    }
}

/// One compiled file, carrying a digest the domain already accepted.
fn executable_row() -> ExecutableRow {
    ExecutableRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        filename: "user".to_string(),
        digest: DIGEST
            .parse()
            .expect("the fixture is a digest the domain allows"),
    }
}

/// The score fields of one result.
fn score_row() -> ScoreRow {
    ScoreRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        score: Some(100.0),
        score_details: Some(SCORE_DETAILS.to_string()),
        scored_at: Some(
            chrono::DateTime::from_timestamp(1_700_000_000, 0)
                .expect("the fixture seconds are in range")
                .naive_utc(),
        ),
        public_score: Some(100.0),
        public_score_details: Some(SCORE_DETAILS.to_string()),
        ranking_score_details: Some(vec![GRADER_TEXT.to_string()]),
    }
}

/// One audit row carrying the actor, the verb, the table and the state written.
fn audit_row(entity: &str, after: RowState) -> AuditRow {
    AuditRow {
        actor_id: Some(ACTOR_ID),
        verb: "update".to_string(),
        entity: entity.to_string(),
        entity_id: format!("{SUBMISSION_ID}/{DATASET_ID}"),
        before: None,
        after,
        reason: "judging commit".to_string(),
    }
}

/// One finished operation on one object, holding its audit row or none at all.
fn write(operation: OperationType, testcase_id: Option<i32>, audited: bool) -> ObjectWrite {
    let is_compilation = operation == OperationType::Compilation;
    let mut batch = ObjectWrite {
        operation,
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        result: result_row(),
        executables: if is_compilation {
            vec![executable_row()]
        } else {
            Vec::new()
        },
        evaluations: testcase_id.map(evaluation_row).into_iter().collect(),
        score: None,
        audit: vec![audit_row(
            "submission_results",
            RowState::Result(result_row()),
        )],
    };
    if !audited {
        batch.audit.clear();
    }
    batch
}

#[test]
fn the_operations_on_one_object_and_type_collapse_into_one_batch_of_their_rows() {
    let operations = [
        write(OperationType::Evaluation, Some(TESTCASE_ID), true),
        write(OperationType::Evaluation, Some(OTHER_TESTCASE_ID), true),
    ];

    let batches = group_by_object(&operations).expect("both operations carry an audit row");
    let batch = &batches[0];

    assert_eq!(batches.len(), 1);
    assert_eq!(batch.evaluations.len(), 2);
    assert_eq!(batch.audit.len(), 2);
    assert!(batch
        .evaluations
        .iter()
        .all(|row| row.submission_id == batch.submission_id && row.dataset_id == batch.dataset_id));
    assert!(batch
        .audit
        .iter()
        .all(|row| row.after == RowState::Result(batch.result.clone())));
}

#[test]
fn one_batch_is_returned_per_object_and_type_in_key_order() {
    let mut other_object = write(OperationType::Evaluation, Some(TESTCASE_ID), true);
    other_object.submission_id = OTHER_SUBMISSION_ID;
    let operations = [
        write(OperationType::Evaluation, Some(TESTCASE_ID), true),
        other_object,
        write(OperationType::Compilation, None, true),
    ];

    let batches = group_by_object(&operations).expect("every operation carries an audit row");
    let keys: Vec<(OperationType, i32)> = batches
        .iter()
        .map(|b| (b.operation, b.submission_id))
        .collect();

    assert_eq!(
        keys,
        vec![
            (OperationType::Compilation, SUBMISSION_ID),
            (OperationType::Evaluation, SUBMISSION_ID),
            (OperationType::Evaluation, OTHER_SUBMISSION_ID),
        ]
    );
}

#[test]
fn a_batch_keeps_the_state_the_last_of_its_operations_left() {
    let mut later = write(OperationType::Evaluation, Some(OTHER_TESTCASE_ID), true);
    later.result.evaluation_tries = 2;
    let operations = [
        write(OperationType::Evaluation, Some(TESTCASE_ID), true),
        later,
    ];

    let batches = group_by_object(&operations).expect("both operations carry an audit row");

    assert_eq!(batches[0].result.evaluation_tries, 2);
}

#[test]
fn a_batch_with_no_audit_row_neither_groups_nor_seals() {
    let unaudited = write(OperationType::Evaluation, Some(TESTCASE_ID), false);
    let unaudited_error = WriteError::MissingAudit {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
    };

    assert_eq!(
        group_by_object(std::slice::from_ref(&unaudited)),
        Err(unaudited_error)
    );
    assert_eq!(unaudited.seal(), Err(unaudited_error));
    assert!(write(OperationType::Evaluation, Some(TESTCASE_ID), true)
        .seal()
        .is_ok());
}

#[test]
fn an_audit_row_names_its_actor_its_verb_its_table_and_the_state_it_writes() {
    let executable = executable_row();
    let row = audit_row("executables", RowState::Executable(executable.clone()));

    assert_eq!(row.actor_id, Some(ACTOR_ID));
    assert_eq!(row.verb, "update");
    assert_eq!(row.entity, "executables");
    assert_eq!(row.entity_id, format!("{SUBMISSION_ID}/{DATASET_ID}"));
    assert_eq!(row.after, RowState::Executable(executable.clone()));
    assert!(row.before.is_none(), "a created row has no state before it");
    assert_eq!(executable.digest.as_str(), DIGEST);
}

#[test]
fn a_scored_batch_writes_its_five_score_fields_and_the_time_they_were_stamped() {
    let mut scored = write(OperationType::Evaluation, Some(TESTCASE_ID), true);
    scored.score = Some(score_row());

    let batch = scored.seal().expect("the batch carries an audit row");
    let score = batch
        .score
        .expect("a scored batch carries its score fields");

    assert_eq!(score.score_details.as_deref(), Some(SCORE_DETAILS));
    assert!(score.scored_at.is_some() && score.ranking_score_details.is_some());
}
