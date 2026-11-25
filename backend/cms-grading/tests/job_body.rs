//! Exact worker-body serialization for the two submission jobs.
//!
//! The oracle is the pinned key set in `cms-proto` and the fixture values the
//! constructors were built from, not the body the serializer just produced.

use std::collections::{BTreeMap, BTreeSet};

use cms_grading::job::{CompilationJob, Dataset, EvaluationJob, Submission, Testcase};
use cms_proto::{key_set_for, DigestMap, JobKey, JobKind, Operation, OperationKind};
use serde_json::{json, Map, Value};

const OBJECT: i64 = 7;
const DATASET: i64 = 3;
const TESTCASE: &str = "1.in";
const INPUT: &str = "in";
const OUTPUT: &str = "out";
const LANGUAGE: &str = "C++ 17";
const TIME_LIMIT: f64 = 5.0;
const MEMORY_LIMIT: i64 = 1024;

fn digests(pairs: &[(&str, &str)]) -> DigestMap {
    pairs
        .iter()
        .map(|(name, digest)| ((*name).to_owned(), (*digest).to_owned()))
        .collect()
}

fn operation(kind: OperationKind) -> Operation {
    Operation {
        kind,
        object_id: OBJECT,
        dataset_id: DATASET,
        testcase_codename: None,
        archive_sandbox: true,
    }
}

fn dataset() -> Dataset {
    let mut testcases = BTreeMap::new();
    testcases.insert(
        TESTCASE.to_owned(),
        Testcase {
            codename: TESTCASE.to_owned(),
            input: INPUT.to_owned(),
            output: OUTPUT.to_owned(),
        },
    );
    Dataset {
        id: DATASET,
        task_type: "batch".to_owned(),
        task_type_parameters: json!({ "token": "batch" }),
        managers: digests(&[("grader.cpp", "g"), ("grader.h", "h")]),
        auto_managers: None,
        testcases,
        time_limit: Some(TIME_LIMIT),
        memory_limit: Some(MEMORY_LIMIT),
    }
}

fn submission() -> Submission {
    Submission {
        id: OBJECT,
        language: Some(LANGUAGE.to_owned()),
        language_descriptor: None,
        files: digests(&[("sol.cpp", "f")]),
        result_executables: digests(&[("sol", "e")]),
        multithreaded_sandbox: true,
    }
}

fn compilation_job() -> CompilationJob {
    CompilationJob::from_submission(
        &operation(OperationKind::Compilation),
        &submission(),
        &dataset(),
    )
    .expect("a compilation for this submission builds")
}

fn evaluation_job() -> EvaluationJob {
    let mut op = operation(OperationKind::Evaluation);
    op.testcase_codename = Some(TESTCASE.to_owned());
    EvaluationJob::from_submission(&op, &submission(), &dataset())
        .expect("an evaluation naming this testcase builds")
}

fn value(body: &Map<String, Value>, key: JobKey) -> &Value {
    body.get(key.as_str())
        .expect("a pinned key must be present")
}

fn assert_value(body: &Map<String, Value>, key: JobKey, want: Value) {
    assert_eq!(value(body, key), &want);
}

fn assert_key_set(body: &Map<String, Value>, kind: JobKind) {
    let found: BTreeSet<&str> = body.keys().map(String::as_str).collect();
    let pinned: BTreeSet<&str> = key_set_for(kind).iter().copied().collect();
    assert_eq!(found, pinned, "exported key set must equal the pinned set");
}

fn assert_operation(body: &Map<String, Value>, expected: &Operation) {
    let want = json!({
        "type": expected.kind.name(),
        "object_id": expected.object_id,
        "dataset_id": expected.dataset_id,
        "testcase_codename": expected.testcase_codename.as_deref(),
        "archive_sandbox": expected.archive_sandbox,
    });
    assert_eq!(value(body, JobKey::OPERATION), &want);
}

fn assert_worker_defaults(body: &Map<String, Value>) {
    assert_value(body, JobKey::SHARD, Value::Null);
    assert_value(body, JobKey::KEEP_SANDBOX, json!(false));
    assert_value(body, JobKey::SANDBOXES, json!([]));
    assert_value(body, JobKey::SANDBOX_DIGESTS, json!({}));
    assert_value(body, JobKey::SUCCESS, Value::Null);
    assert_value(body, JobKey::TEXT, Value::Null);
    assert_value(body, JobKey::ADMIN_TEXT, Value::Null);
    assert_value(body, JobKey::PLUS, Value::Null);
}

#[test]
fn compilation_body_has_exactly_the_pinned_key_set() {
    assert_key_set(&compilation_job().to_body(), JobKind::Compilation);
}

#[test]
fn evaluation_body_has_exactly_the_pinned_key_set() {
    assert_key_set(&evaluation_job().to_body(), JobKind::Evaluation);
}

#[test]
fn compilation_body_writes_the_job_fields_and_maps() {
    let job = compilation_job();
    let body = job.to_body();
    assert_value(&body, JobKey::TYPE, json!(JobKind::Compilation.as_str()));
    assert_operation(
        &body,
        job.operation
            .as_ref()
            .expect("a built job has an operation"),
    );
    assert_value(&body, JobKey::FILES, json!({"sol.cpp": "f"}));
    assert_value(
        &body,
        JobKey::MANAGERS,
        json!({"grader.cpp": "g", "grader.h": "h"}),
    );
    assert_value(&body, JobKey::EXECUTABLES, json!({}));
    assert_value(&body, JobKey::COMPILATION_SUCCESS, Value::Null);
    assert_worker_defaults(&body);
}

#[test]
fn evaluation_body_writes_the_job_fields_maps_and_limits() {
    let job = evaluation_job();
    let body = job.to_body();
    assert_value(&body, JobKey::TYPE, json!(JobKind::Evaluation.as_str()));
    assert_operation(
        &body,
        job.operation
            .as_ref()
            .expect("a built job has an operation"),
    );
    assert_value(&body, JobKey::FILES, json!({"sol.cpp": "f"}));
    assert_value(
        &body,
        JobKey::MANAGERS,
        json!({"grader.cpp": "g", "grader.h": "h"}),
    );
    assert_value(&body, JobKey::EXECUTABLES, json!(job.executables));
    assert_value(&body, JobKey::INPUT, json!(INPUT));
    assert_value(&body, JobKey::OUTPUT, json!(OUTPUT));
    assert_value(&body, JobKey::TIME_LIMIT, json!(TIME_LIMIT));
    assert_value(&body, JobKey::MEMORY_LIMIT, json!(MEMORY_LIMIT));
    assert_value(&body, JobKey::ONLY_EXECUTION, json!(false));
    assert_value(&body, JobKey::GET_OUTPUT, json!(false));
    assert_value(&body, JobKey::OUTCOME, Value::Null);
    assert_value(&body, JobKey::USER_OUTPUT, Value::Null);
    assert_worker_defaults(&body);
}

#[test]
fn compilation_body_round_trips_through_from_body() {
    let job = compilation_job();
    let decoded = CompilationJob::from_body(&job.to_body()).expect("the exported body decodes");
    assert_eq!(decoded, job);
}

#[test]
fn evaluation_body_round_trips_through_from_body() {
    let job = evaluation_job();
    let decoded = EvaluationJob::from_body(&job.to_body()).expect("the exported body decodes");
    assert_eq!(decoded, job);
}

#[test]
fn absent_optional_operation_and_language_serialize_as_null() {
    let mut compilation = compilation_job();
    compilation.operation = None;
    compilation.language = None;
    let compilation_body = compilation.to_body();
    assert_value(&compilation_body, JobKey::OPERATION, Value::Null);
    assert_value(&compilation_body, JobKey::LANGUAGE, Value::Null);

    let mut evaluation = evaluation_job();
    evaluation.operation = None;
    evaluation.language = None;
    let evaluation_body = evaluation.to_body();
    assert_value(&evaluation_body, JobKey::OPERATION, Value::Null);
    assert_value(&evaluation_body, JobKey::LANGUAGE, Value::Null);
}
