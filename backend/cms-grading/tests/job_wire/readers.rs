use crate::job_wire_fixtures::{
    compilation_body, compilation_operation, digests, evaluation_body, evaluation_operation,
};
use cms_grading::job::{CompilationJob, EvaluationJob};
use cms_proto::JobError;
use serde_json::json;

#[test]
fn a_full_compilation_body_reads_only_its_input_fields() {
    let body = compilation_body();
    let job = CompilationJob::from_body(body.as_object().expect("a job object"))
        .expect("the reference compilation body imports");

    assert_eq!(job.operation, Some(compilation_operation()));
    assert_eq!(job.task_type, "Batch");
    assert_eq!(job.task_type_parameters, json!({"compilation": "grader"}));
    assert_eq!(job.language.as_deref(), Some("C++17"));
    assert!(!job.multithreaded_sandbox);
    assert!(!job.archive_sandbox);
    assert_eq!(job.info, "Compilation");
    assert_eq!(
        job.files,
        digests(&[("foo.cpp", "1111111111111111111111111111111111111111")])
    );
    assert_eq!(
        job.managers,
        digests(&[("grader.cpp", "2222222222222222222222222222222222222222")])
    );
    for key in [
        "success",
        "text",
        "admin_text",
        "executables",
        "compilation_success",
        "plus",
    ] {
        assert!(body[key].is_null(), "{key} is an unrun result field");
    }
}

#[test]
fn a_full_evaluation_body_reads_only_its_input_fields() {
    let body = evaluation_body();
    let job = EvaluationJob::from_body(body.as_object().expect("a job object"))
        .expect("the reference evaluation body imports");

    assert_eq!(job.operation, Some(evaluation_operation()));
    assert_eq!(job.task_type, "Batch");
    assert_eq!(job.task_type_parameters, json!({"evaluation": "grader"}));
    assert_eq!(job.language.as_deref(), Some("C++17"));
    assert!(!job.multithreaded_sandbox);
    assert!(!job.archive_sandbox);
    assert_eq!(job.info, "Evaluation");
    assert_eq!(job.input, "4444444444444444444444444444444444444444");
    assert_eq!(
        job.output.as_deref(),
        Some("5555555555555555555555555555555555555555")
    );
    assert_eq!(job.time_limit, Some(2.0));
    assert_eq!(job.memory_limit, Some(262_144));
    assert_eq!(job.only_execution, Some(false));
    assert_eq!(job.get_output, Some(false));
    for key in [
        "success",
        "text",
        "admin_text",
        "outcome",
        "user_output",
        "plus",
    ] {
        assert!(body[key].is_null(), "{key} is an unrun result field");
    }
}

#[test]
fn the_three_digest_maps_keep_every_name_and_digest() {
    let compilation =
        CompilationJob::from_body(compilation_body().as_object().expect("a job object"))
            .expect("the compilation imports");
    let evaluation = EvaluationJob::from_body(evaluation_body().as_object().expect("a job object"))
        .expect("the evaluation imports");

    assert_eq!(
        compilation.files,
        digests(&[("foo.cpp", "1111111111111111111111111111111111111111")])
    );
    assert_eq!(
        compilation.managers,
        digests(&[("grader.cpp", "2222222222222222222222222222222222222222")])
    );
    assert_eq!(evaluation.files, compilation.files);
    assert_eq!(evaluation.managers, compilation.managers);
    assert_eq!(
        evaluation.executables,
        digests(&[("foo", "3333333333333333333333333333333333333333")])
    );
}

#[test]
fn an_extra_key_is_refused_by_name() {
    let mut body = compilation_body();
    body.as_object_mut()
        .expect("a job object")
        .insert("retries".to_owned(), json!(3));

    assert_eq!(
        CompilationJob::from_body(body.as_object().expect("a job object")),
        Err(JobError::UnknownKey {
            key: "retries".to_owned()
        })
    );
}

#[test]
fn a_missing_task_type_is_refused_by_name() {
    let mut body = evaluation_body();
    body.as_object_mut()
        .expect("a job object")
        .remove("task_type");

    assert_eq!(
        EvaluationJob::from_body(body.as_object().expect("a job object")),
        Err(JobError::MissingKey { key: "task_type" })
    );
}

#[test]
fn an_unknown_type_tag_is_refused() {
    let mut body = compilation_body();
    body["type"] = json!("user_test");

    assert_eq!(
        CompilationJob::from_body(body.as_object().expect("a job object")),
        Err(JobError::UnknownJobType {
            found: "user_test".to_owned()
        })
    );
}

#[test]
fn a_known_type_of_the_other_kind_is_refused() {
    assert_eq!(
        CompilationJob::from_body(evaluation_body().as_object().expect("a job object")),
        Err(JobError::WrongValue {
            key: "type",
            detail: "expected compilation".to_owned()
        })
    );
}

#[test]
fn a_null_operation_imports_as_none() {
    let mut compilation = compilation_body();
    compilation["operation"] = json!(null);
    let mut evaluation = evaluation_body();
    evaluation["operation"] = json!(null);

    assert_eq!(
        CompilationJob::from_body(compilation.as_object().expect("a job object"))
            .expect("null is a declared operation")
            .operation,
        None
    );
    assert_eq!(
        EvaluationJob::from_body(evaluation.as_object().expect("a job object"))
            .expect("null is a declared operation")
            .operation,
        None
    );
}
