//! The typed-job path a worker runs, with the work's store decided by each test.
//!
//! The bodies are built from the protocol's own key sets, so a result is checked
//! against the same shape the service sent rather than a second list of fields.
//! Output-only jobs decide their results without a box; the cache fakes are used
//! only where a carried answer has to be read.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use cms_grading::stage::{Cache, CacheError, CacheHandle, FileDigest, FsCache, StageError};
use cms_grading::steps::TrustedLimits;
use cms_grading::tasktypes::{CompilationLimits, Runtime};
use cms_proto::{key_set_for, JobKey, JobKind, OPERATION_KEYS};
use serde_json::{json, Map, Value};

use crate::edge::JobError;
use crate::run::{run_job, Runner};

/// A digest the cache may be asked for without refusing the digest itself.
const STORED_DIGEST: &str = "0000000000000000000000000000000000000000";

/// A cache no successful job in this suite may read.
struct UnusedCache;

impl Cache for UnusedCache {
    fn get_file(&self, _handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        panic!("this job must not read a file")
    }

    fn put_file(&self, _digest: &FileDigest, _content: &[u8]) -> Result<bool, StageError> {
        Ok(false)
    }
}

/// A cache that refuses every read with the sentence a test chose.
struct RefusingCache {
    refusal: StageError,
}

impl Cache for RefusingCache {
    fn get_file(&self, _handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        Err(self.refusal.clone())
    }

    fn put_file(&self, _digest: &FileDigest, _content: &[u8]) -> Result<bool, StageError> {
        Ok(false)
    }
}

/// A cache whose carried answer and correct output are the same bytes.
struct AnswerCache;

impl Cache for AnswerCache {
    fn get_file(&self, _handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        Ok(b"the answer".to_vec())
    }

    fn put_file(&self, _digest: &FileDigest, _content: &[u8]) -> Result<bool, StageError> {
        Ok(false)
    }
}

/// A directory this test owns, cleared before the case starts.
fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("cms-worker-run-tests").join(name);
    match fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => panic!("the test's old directory must be removable: {error}"),
    }
    fs::create_dir_all(&dir).expect("the test's directory must be creatable");
    dir
}

/// A runtime no job in this suite launches a box under.
fn runtime(dir: &Path) -> Runtime {
    Runtime::new(
        dir.join("isolate"),
        dir,
        CompilationLimits {
            time: Some(Duration::from_secs(1)),
            memory: Some(1024),
            processes: Some(1),
        },
        Some(1024),
        TrustedLimits::new(1, Duration::from_secs(1), 1024),
    )
}

/// Writes one protocol field without spelling its name a second time.
fn put(body: &mut Map<String, Value>, key: JobKey, value: Value) {
    body.insert(key.as_str().to_owned(), value);
}

/// A complete job envelope, with every key the selected shape requires.
fn body(kind: JobKind) -> Map<String, Value> {
    let mut body: Map<String, Value> = key_set_for(kind)
        .iter()
        .map(|key| ((*key).to_owned(), Value::Null))
        .collect();
    put(&mut body, JobKey::TYPE, json!(kind.as_str()));
    put(&mut body, JobKey::TASK_TYPE, json!("OutputOnly"));
    put(&mut body, JobKey::TASK_TYPE_PARAMETERS, json!(["diff"]));
    put(&mut body, JobKey::MULTITHREADED_SANDBOX, json!(false));
    put(&mut body, JobKey::ARCHIVE_SANDBOX, json!(false));
    put(&mut body, JobKey::SHARD, json!(3));
    put(&mut body, JobKey::INFO, json!(""));
    put(&mut body, JobKey::FILES, json!({}));
    put(&mut body, JobKey::MANAGERS, json!({}));
    put(&mut body, JobKey::EXECUTABLES, json!({}));
    if kind == JobKind::Evaluation {
        put(&mut body, JobKey::INPUT, json!(STORED_DIGEST));
    }
    body
}

/// Asserts that writing a result neither dropped nor invented a protocol key.
fn assert_key_set(kind: JobKind, body: &Map<String, Value>) {
    let mut found: Vec<&str> = body.keys().map(String::as_str).collect();
    found.sort_unstable();
    let mut expected: Vec<&str> = key_set_for(kind).to_vec();
    expected.sort_unstable();
    assert_eq!(found, expected);
}

#[test]
fn a_compilation_writes_the_typed_result_without_changing_the_key_set() {
    let dir = workspace("run-compilation");
    let mut body = body(JobKind::Compilation);
    run_job(
        "OutputOnly",
        &mut body,
        &runtime(&dir),
        Box::new(UnusedCache),
    )
    .expect("an output-only compilation needs no files");
    assert_eq!(body[JobKey::SUCCESS.as_str()], json!(true));
    assert_eq!(body[JobKey::COMPILATION_SUCCESS.as_str()], json!(true));
    assert_eq!(
        body[JobKey::TEXT.as_str()],
        json!(["No compilation needed"])
    );
    assert_eq!(body[JobKey::PLUS.as_str()], json!({}));
    assert_key_set(JobKind::Compilation, &body);
}

#[test]
fn an_evaluation_writes_the_typed_result_without_changing_the_key_set() {
    let dir = workspace("run-evaluation");
    let mut body = body(JobKind::Evaluation);
    run_job(
        "OutputOnly",
        &mut body,
        &runtime(&dir),
        Box::new(UnusedCache),
    )
    .expect("an output-only job with no carried answer is a scored result");
    assert_eq!(body[JobKey::SUCCESS.as_str()], json!(true));
    assert_eq!(body[JobKey::OUTCOME.as_str()], json!("0.0"));
    assert_eq!(body[JobKey::TEXT.as_str()], json!(["File not submitted"]));
    assert_eq!(body[JobKey::PLUS.as_str()], json!({}));
    assert!(body[JobKey::USER_OUTPUT.as_str()].is_null());
    assert_key_set(JobKind::Evaluation, &body);
}

#[test]
fn a_configuration_refusal_is_written_as_a_failed_result() {
    let dir = workspace("run-configuration-refusal");
    let mut body = body(JobKind::Compilation);
    put(&mut body, JobKey::TASK_TYPE, json!("Batch"));
    put(
        &mut body,
        JobKey::TASK_TYPE_PARAMETERS,
        json!(["alone", ["", ""], "diff"]),
    );
    put(&mut body, JobKey::LANGUAGE, json!("C++17 / g++"));
    run_job("Batch", &mut body, &runtime(&dir), Box::new(UnusedCache))
        .expect("the grading seam translates configuration refusals into results");
    assert_eq!(body[JobKey::SUCCESS.as_str()], json!(false));
    assert!(body[JobKey::COMPILATION_SUCCESS.as_str()].is_null());
    assert!(body[JobKey::TEXT.as_str()].is_null());
    assert!(body[JobKey::PLUS.as_str()].is_null());
    assert_key_set(JobKind::Compilation, &body);
}

#[test]
fn an_unknown_language_is_work_with_the_lookup_sentence() {
    let dir = workspace("run-unknown-language");
    let mut body = body(JobKind::Compilation);
    put(&mut body, JobKey::TASK_TYPE, json!("Batch"));
    put(
        &mut body,
        JobKey::TASK_TYPE_PARAMETERS,
        json!(["alone", ["", ""], "diff"]),
    );
    put(&mut body, JobKey::LANGUAGE, json!("C++"));
    let refusal = run_job("Batch", &mut body, &runtime(&dir), Box::new(UnusedCache))
        .expect_err("a Batch compilation needs the language it named");
    assert_eq!(
        refusal,
        JobError::Work {
            reason: String::from("Unknown language `C++`."),
        }
    );
}

#[test]
fn output_only_phases_ignore_an_unknown_language() {
    let dir = workspace("run-output-only-unknown-language");
    for kind in [JobKind::Compilation, JobKind::Evaluation] {
        let mut body = body(kind);
        put(&mut body, JobKey::LANGUAGE, json!("C++"));
        run_job(
            "OutputOnly",
            &mut body,
            &runtime(&dir),
            Box::new(UnusedCache),
        )
        .expect("an output-only phase never reads a toolchain");
        assert_eq!(body[JobKey::SUCCESS.as_str()], json!(true));
        assert_eq!(body[JobKey::SANDBOXES.as_str()], json!([]));
    }
}

#[test]
fn batch_and_output_answer_only_phases_ignore_an_unknown_language() {
    let dir = workspace("run-mixed-answer-unknown-language");
    let parameters = json!(["alone", ["", ""], "diff", ""]);
    let mut compilation = body(JobKind::Compilation);
    put(&mut compilation, JobKey::TASK_TYPE, json!("BatchAndOutput"));
    put(
        &mut compilation,
        JobKey::TASK_TYPE_PARAMETERS,
        parameters.clone(),
    );
    put(
        &mut compilation,
        JobKey::FILES,
        json!({"output_1.in.txt": STORED_DIGEST}),
    );
    put(&mut compilation, JobKey::LANGUAGE, json!("C++"));
    run_job(
        "BatchAndOutput",
        &mut compilation,
        &runtime(&dir),
        Box::new(UnusedCache),
    )
    .expect("an answer-only compilation needs no toolchain");
    assert_eq!(compilation[JobKey::SUCCESS.as_str()], json!(true));
    assert_eq!(
        compilation[JobKey::COMPILATION_SUCCESS.as_str()],
        json!(true)
    );
    assert_eq!(compilation[JobKey::SANDBOXES.as_str()], json!([]));

    let mut evaluation = carried_answer();
    put(&mut evaluation, JobKey::TASK_TYPE, json!("BatchAndOutput"));
    put(&mut evaluation, JobKey::TASK_TYPE_PARAMETERS, parameters);
    put(&mut evaluation, JobKey::LANGUAGE, json!("C++"));
    run_job(
        "BatchAndOutput",
        &mut evaluation,
        &runtime(&dir),
        Box::new(AnswerCache),
    )
    .expect("a carried answer needs no toolchain");
    assert_eq!(evaluation[JobKey::SUCCESS.as_str()], json!(true));
    assert_eq!(evaluation[JobKey::OUTCOME.as_str()], json!("1.0"));
    assert_eq!(
        evaluation[JobKey::TEXT.as_str()],
        json!(["Output is correct"])
    );
    assert_eq!(evaluation[JobKey::SANDBOXES.as_str()], json!([]));
}

#[test]
fn a_batch_and_output_listed_testcase_ignores_an_unknown_language() {
    let dir = workspace("run-mixed-listed-unknown-language");
    let mut body = carried_answer();
    put(&mut body, JobKey::TASK_TYPE, json!("BatchAndOutput"));
    put(
        &mut body,
        JobKey::TASK_TYPE_PARAMETERS,
        json!(["alone", ["", ""], "diff", "1.in"]),
    );
    put(&mut body, JobKey::FILES, json!({}));
    put(
        &mut body,
        JobKey::EXECUTABLES,
        json!({"sol": STORED_DIGEST}),
    );
    put(&mut body, JobKey::LANGUAGE, json!("C++"));
    run_job(
        "BatchAndOutput",
        &mut body,
        &runtime(&dir),
        Box::new(UnusedCache),
    )
    .expect("a listed output-only testcase never reaches the Batch phase");
    assert_eq!(body[JobKey::SUCCESS.as_str()], json!(true));
    assert_eq!(body[JobKey::OUTCOME.as_str()], json!("0.0"));
    assert_eq!(body[JobKey::TEXT.as_str()], json!(["File not submitted"]));
    assert_eq!(body[JobKey::SANDBOXES.as_str()], json!([]));
}

#[test]
fn a_missing_language_on_a_batch_job_keeps_the_no_language_reason() {
    let dir = workspace("run-missing-language");
    let mut body = body(JobKind::Compilation);
    put(&mut body, JobKey::TASK_TYPE, json!("Batch"));
    put(
        &mut body,
        JobKey::TASK_TYPE_PARAMETERS,
        json!(["alone", ["", ""], "diff"]),
    );
    let refusal = run_job("Batch", &mut body, &runtime(&dir), Box::new(UnusedCache))
        .expect_err("a Batch compilation cannot run without a language");
    assert_eq!(
        refusal,
        JobError::Work {
            reason: String::from("the job needs a language, but no toolchain was given"),
        }
    );
}

#[test]
fn bad_task_parameters_are_work_with_the_task_sentence() {
    let dir = workspace("run-bad-parameters");
    let mut body = body(JobKind::Compilation);
    put(&mut body, JobKey::TASK_TYPE_PARAMETERS, json!(["neither"]));
    put(&mut body, JobKey::LANGUAGE, json!("C++"));
    let refusal = run_job(
        "OutputOnly",
        &mut body,
        &runtime(&dir),
        Box::new(UnusedCache),
    )
    .expect_err("parameters outside the task's declaration are refused");
    assert!(matches!(
        refusal,
        JobError::Work { reason } if reason.contains("parameter `Output evaluation`")
    ));
}

#[test]
fn a_malformed_body_is_work_with_the_protocol_sentence() {
    let dir = workspace("run-malformed-body");
    let mut body = body(JobKind::Compilation);
    body.remove(JobKey::INFO.as_str());
    let refusal = run_job(
        "OutputOnly",
        &mut body,
        &runtime(&dir),
        Box::new(UnusedCache),
    )
    .expect_err("a body outside the pinned shape is refused");
    assert_eq!(
        refusal,
        JobError::Work {
            reason: String::from("key \"info\" is required but absent"),
        }
    );
}

/// An output-only evaluation that has to read the answer it carries.
fn carried_answer() -> Map<String, Value> {
    let mut body = body(JobKind::Evaluation);
    let mut operation: Map<String, Value> = OPERATION_KEYS
        .iter()
        .map(|key| ((*key).to_owned(), Value::Null))
        .collect();
    put(&mut operation, JobKey::TYPE, json!("evaluate"));
    put(&mut operation, JobKey::OBJECT_ID, json!(7));
    put(&mut operation, JobKey::DATASET_ID, json!(3));
    put(&mut operation, JobKey::TESTCASE_CODENAME, json!("1.in"));
    put(&mut operation, JobKey::ARCHIVE_SANDBOX, json!(false));
    put(&mut body, JobKey::OPERATION, Value::Object(operation));
    put(
        &mut body,
        JobKey::FILES,
        json!({"output_1.in.txt": STORED_DIGEST}),
    );
    put(&mut body, JobKey::OUTPUT, json!(STORED_DIGEST));
    body
}

#[test]
fn a_tombstone_from_the_cache_keeps_its_job_result_meaning() {
    let dir = workspace("run-tombstone");
    let mut body = carried_answer();
    put(
        &mut body,
        JobKey::FILES,
        json!({"output_1.in.txt": FileDigest::tombstone().as_str()}),
    );
    let cache = RefusingCache {
        refusal: StageError::Cache(CacheError::Tombstone),
    };
    assert_eq!(
        run_job("OutputOnly", &mut body, &runtime(&dir), Box::new(cache),),
        Err(JobError::Tombstone)
    );
}

#[test]
fn another_cache_refusal_is_work_with_the_stage_sentence() {
    let dir = workspace("run-cache-refusal");
    let mut body = carried_answer();
    let cache = RefusingCache {
        refusal: StageError::Store {
            reason: String::from("disk full"),
        },
    };
    assert_eq!(
        run_job("OutputOnly", &mut body, &runtime(&dir), Box::new(cache),),
        Err(JobError::Work {
            reason: String::from("the store refused: disk full"),
        })
    );
}

#[test]
fn the_public_runner_executes_with_a_clone_of_its_filesystem_cache() {
    let dir = workspace("run-public-runner");
    let cache = FsCache::at(dir.join("cache")).expect("a cache directory");
    let runner = Runner::new(runtime(&dir), cache);
    let mut body = body(JobKind::Compilation);
    runner
        .run("OutputOnly", &mut body)
        .expect("the runner executes a typed compilation");
    assert_eq!(body[JobKey::SUCCESS.as_str()], json!(true));
    assert_eq!(
        body[JobKey::TEXT.as_str()],
        json!(["No compilation needed"])
    );
}
