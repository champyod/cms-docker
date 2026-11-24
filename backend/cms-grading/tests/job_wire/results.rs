use std::path::PathBuf;
use std::str::FromStr;

use cms_grading::job::{CompilationJob, EvaluationJob};
use cms_grading::stage::FileDigest;
use cms_grading::tasktypes::{Compilation, Evaluation};
use cms_proto::{DecodedJob, KindExtras, OperationKind, Shard};
use cms_sandbox::{ExecutionStats, ExitStatus};
use serde_json::{json, Value};

use crate::job_wire_fixtures::{
    compilation_body, compilation_operation, digests, evaluation_body, evaluation_operation,
    finished,
};

fn stats() -> ExecutionStats {
    ExecutionStats {
        cpu_time: Some(1.25),
        wall_time: Some(2.5),
        memory_bytes: Some(2048),
        exit_status: ExitStatus::Ok,
        signal: None,
        stdout: Some("notice".to_owned()),
        stderr: Some("warning".to_owned()),
    }
}

fn compilation() -> Compilation {
    Compilation {
        sandboxes: vec![PathBuf::from("/sandbox/compile")],
        success: true,
        compilation_success: Some(true),
        text: vec!["Compilation succeeded".to_owned()],
        stats: Some(stats()),
        executables: digests(&[("foo", "3333333333333333333333333333333333333333")]),
        diagnostics: Default::default(),
    }
}

fn evaluation() -> Evaluation {
    Evaluation {
        sandboxes: vec![PathBuf::from("/sandbox/evaluate")],
        success: true,
        ran: true,
        outcome: Some(42.5),
        text: vec!["Output is correct".to_owned()],
        admin_text: Some("read the input twice".to_owned()),
        stats: Some(stats()),
        user_output: Some(
            FileDigest::from_str("6666666666666666666666666666666666666666")
                .expect("a stored output digest"),
        ),
        output_file: None,
    }
}

fn decoded(body: &Value) -> DecodedJob {
    let batch = finished(body);
    assert!(batch.quarantined().is_empty());
    batch.committed().remove(0).clone()
}

#[test]
fn a_compilation_writer_fills_the_keys_the_finished_decoder_reads() {
    let mut body = compilation_body();
    let result = compilation();
    result.write_body(body.as_object_mut().expect("a job object"));

    assert_eq!(body["success"], json!(true));
    assert_eq!(body["text"], json!(["Compilation succeeded"]));
    assert!(body["admin_text"].is_null());
    assert_eq!(body["sandboxes"], json!(["/sandbox/compile"]));
    assert_eq!(
        body["executables"],
        json!({"foo": "3333333333333333333333333333333333333333"})
    );
    assert_eq!(body["compilation_success"], json!(true));

    let decoded = decoded(&body);
    assert_eq!(decoded.operation.as_ref(), Some(&compilation_operation()));
    assert_eq!(decoded.success, Some(true));
    assert_eq!(decoded.shard, Shard::new(3));
    assert_eq!(decoded.sandboxes, vec!["/sandbox/compile"]);
    assert_eq!(
        decoded.executables,
        digests(&[("foo", "3333333333333333333333333333333333333333")])
    );
    assert_eq!(
        decoded.extras,
        KindExtras::Compilation {
            compilation_success: Some(true)
        }
    );
}

#[test]
fn an_evaluation_writer_fills_the_keys_the_finished_decoder_reads() {
    let mut body = evaluation_body();
    let result = evaluation();
    result.write_body(body.as_object_mut().expect("a job object"));

    assert_eq!(body["outcome"], json!("42.5"));
    assert_eq!(
        body["user_output"],
        json!("6666666666666666666666666666666666666666")
    );

    let decoded = decoded(&body);
    assert_eq!(decoded.operation.as_ref(), Some(&evaluation_operation()));
    assert_eq!(decoded.success, Some(true));
    assert_eq!(decoded.shard, Shard::new(3));
    assert_eq!(decoded.sandboxes, vec!["/sandbox/evaluate"]);
    assert_eq!(
        decoded.executables,
        digests(&[("foo", "3333333333333333333333333333333333333333")])
    );
    let KindExtras::Evaluation(outcome) = &decoded.extras else {
        panic!("an evaluation result carries evaluation extras");
    };
    assert_eq!(outcome.outcome.as_deref(), Some("42.5"));
    assert_eq!(
        outcome.user_output.as_deref(),
        Some("6666666666666666666666666666666666666666")
    );
    assert_eq!(
        outcome.input.as_deref(),
        Some("4444444444444444444444444444444444444444")
    );
    assert_eq!(outcome.time_limit, Some(2.0));
    assert_eq!(outcome.memory_limit, Some(262_144));
    assert_eq!(outcome.only_execution, Some(false));
    assert_eq!(outcome.get_output, Some(false));
}

#[test]
fn evaluation_text_stays_a_string_list_beside_admin_text() {
    let mut body = evaluation_body();
    let mut result = evaluation();
    result.text = vec!["Wrong answer: %s".to_owned(), "got".to_owned()];
    result.write_body(body.as_object_mut().expect("a job object"));

    assert_eq!(body["text"], json!(["Wrong answer: %s", "got"]));
    assert_eq!(body["admin_text"], json!("read the input twice"));
}

#[test]
fn execution_stats_become_the_plus_metadata_the_reference_writes() {
    let expected = json!({
        "execution_time": 1.25,
        "execution_wall_clock_time": 2.5,
        "execution_memory": 2048,
        "exit_status": "ok",
        "stdout": "notice",
        "stderr": "warning"
    });
    let mut compilation_body = compilation_body();
    compilation().write_body(compilation_body.as_object_mut().expect("a job object"));
    let mut evaluation_body = evaluation_body();
    evaluation().write_body(evaluation_body.as_object_mut().expect("a job object"));

    assert_eq!(compilation_body["plus"], expected);
    assert_eq!(evaluation_body["plus"], expected);
    assert_eq!(
        finished(&compilation_body).committed()[0].plus,
        Some(expected.clone())
    );
    assert_eq!(
        finished(&evaluation_body).committed()[0].plus,
        Some(expected)
    );
}

#[test]
fn outcomes_use_the_reference_float_string_including_zero() {
    for (score, written) in [(0.0, "0.0"), (42.5, "42.5"), (1.0, "1.0")] {
        let mut body = evaluation_body();
        let mut result = evaluation();
        result.outcome = Some(score);
        result.write_body(body.as_object_mut().expect("a job object"));
        assert_eq!(body["outcome"], json!(written));
    }
}

#[test]
fn absent_result_metadata_is_written_as_null() {
    let mut body = evaluation_body();
    let mut result = evaluation();
    result.stats = None;
    result.user_output = None;
    result.admin_text = None;
    result.outcome = None;
    result.success = false;
    result.write_body(body.as_object_mut().expect("a job object"));

    assert!(body["plus"].is_null());
    assert!(body["user_output"].is_null());
    assert!(body["admin_text"].is_null());
    assert!(body["outcome"].is_null());
}

#[test]
fn a_box_that_worked_but_measured_nothing_reports_an_empty_plus() {
    let mut body = evaluation_body();
    let mut result = evaluation();
    result.stats = None;
    result.success = true;
    result.write_body(body.as_object_mut().expect("a job object"));

    assert_eq!(body["plus"], json!({}));
}

#[test]
fn writers_leave_the_typed_input_fields_unchanged() {
    let mut compilation_body = compilation_body();
    compilation().write_body(compilation_body.as_object_mut().expect("a job object"));
    let mut evaluation_body = evaluation_body();
    evaluation().write_body(evaluation_body.as_object_mut().expect("a job object"));

    let compilation =
        CompilationJob::from_body(compilation_body.as_object().expect("a job object"))
            .expect("the written compilation still imports");
    let evaluation = EvaluationJob::from_body(evaluation_body.as_object().expect("a job object"))
        .expect("the written evaluation still imports");
    assert_eq!(compilation.task_type, "Batch");
    assert_eq!(
        compilation.operation.as_ref().map(|op| op.kind),
        Some(OperationKind::Compilation)
    );
    assert_eq!(evaluation.task_type, "Batch");
    assert_eq!(
        evaluation.operation.as_ref().map(|op| op.kind),
        Some(OperationKind::Evaluation)
    );
}
