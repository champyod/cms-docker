//! The worker's RPC seam: the group envelope, the reference's two refusal
//! sentences, and the base methods composed beside `execute_job_group`.
//!
//! Every job body is built from the protocol's own key set. The only boxed work
//! is an output-only compilation or a carried answer read from a real temporary
//! filesystem cache, so these tests need no isolation program or service host.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use cms_grading::stage::{FileDigest, FsCache};
use cms_grading::steps::TrustedLimits;
use cms_grading::tasktypes::{CompilationLimits, Runtime};
use cms_proto::{key_set_for, JobKey, JobKind, Shard, OPERATION_KEYS};
use serde_json::{json, Map, Value};

use crate::api::{execute_job_group, precache_files, Worker};
use crate::precache::Precache;
use crate::service::Job;

/// The shard every API test asks its worker to stamp.
const SHARD: Shard = Shard::new(3);

/// A digest the cache may be asked for without refusing the digest itself.
const STORED_DIGEST: &str = "0000000000000000000000000000000000000000";

/// A directory this test owns, cleared before the case starts.
fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("cms-worker-api-tests").join(name);
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

/// A worker configured for the one task type these bodies name.
fn worker(name: &str) -> Worker {
    let dir = workspace(name);
    let cache = FsCache::at(dir.join("cache")).expect("a cache directory");
    Worker::new(
        SHARD,
        vec![String::from("OutputOnly")],
        crate::run::Runner::new(runtime(&dir), cache),
    )
}

/// Writes one protocol field without spelling its name a second time.
fn put(body: &mut Map<String, Value>, key: JobKey, value: Value) {
    body.insert(key.as_str().to_owned(), value);
}

/// A complete job envelope before the worker stamps its shard.
fn body(kind: JobKind, task_type: &str) -> Map<String, Value> {
    let mut body: Map<String, Value> = key_set_for(kind)
        .iter()
        .map(|key| ((*key).to_owned(), Value::Null))
        .collect();
    put(&mut body, JobKey::TYPE, json!(kind.as_str()));
    put(&mut body, JobKey::TASK_TYPE, json!(task_type));
    put(&mut body, JobKey::TASK_TYPE_PARAMETERS, json!(["diff"]));
    put(&mut body, JobKey::LANGUAGE, Value::Null);
    put(&mut body, JobKey::MULTITHREADED_SANDBOX, json!(false));
    put(&mut body, JobKey::ARCHIVE_SANDBOX, json!(false));
    put(&mut body, JobKey::INFO, json!(""));
    put(&mut body, JobKey::FILES, json!({}));
    put(&mut body, JobKey::MANAGERS, json!({}));
    put(&mut body, JobKey::EXECUTABLES, json!({}));
    if kind == JobKind::Evaluation {
        put(&mut body, JobKey::INPUT, json!(STORED_DIGEST));
    }
    body
}

/// An output-only evaluation that has to read the answer it carries.
fn carried_answer() -> Map<String, Value> {
    let mut body = body(JobKind::Evaluation, "OutputOnly");
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
        json!({"output_1.in.txt": FileDigest::tombstone().as_str()}),
    );
    put(
        &mut body,
        JobKey::OUTPUT,
        json!(FileDigest::tombstone().as_str()),
    );
    body
}

/// Asserts that a returned body still has exactly its protocol key set.
fn assert_key_set(kind: JobKind, body: &Map<String, Value>) {
    let mut found: Vec<&str> = body.keys().map(String::as_str).collect();
    found.sort_unstable();
    let mut expected: Vec<&str> = key_set_for(kind).to_vec();
    expected.sort_unstable();
    assert_eq!(found, expected);
}

#[test]
fn a_group_returns_the_same_jobs_in_order_with_the_shard_written() {
    let worker = worker("group-order");
    let mut first = body(JobKind::Compilation, "OutputOnly");
    let mut second = body(JobKind::Compilation, "OutputOnly");
    put(&mut first, JobKey::INFO, json!("first"));
    put(&mut second, JobKey::INFO, json!("second"));
    let answered = execute_job_group(&json!({"jobs": [first, second]}), &worker)
        .expect("a free worker runs the group");
    let jobs = answered["jobs"].as_array().expect("the group envelope");
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0]["info"], json!("first"));
    assert_eq!(jobs[1]["info"], json!("second"));
    for job in jobs {
        assert_eq!(job["shard"], json!(SHARD.get()));
        assert_eq!(job["success"], json!(true));
        assert_eq!(job["text"], json!(["No compilation needed"]));
        assert_key_set(JobKind::Compilation, job.as_object().expect("a job body"));
    }
}

#[test]
fn a_job_naming_an_unconfigured_task_type_fails_the_whole_group() {
    let worker = worker("unknown-task");
    let first = body(JobKind::Compilation, "OutputOnly");
    let second = body(JobKind::Compilation, "minimax");
    let refusal = execute_job_group(&json!({"jobs": [first, second]}), &worker)
        .expect_err("an unknown task type fails the group");
    assert_eq!(
        refusal,
        "Worker failed: no task type named `minimax` is available to this worker."
    );
}

#[test]
fn a_malformed_envelope_is_refused() {
    let worker = worker("malformed-envelope");
    for data in [json!([]), json!({}), json!({"jobs": "none"})] {
        let refusal = execute_job_group(&data, &worker).expect_err("a malformed group is refused");
        assert!(
            !refusal.is_empty(),
            "the refusal names the malformed envelope"
        );
    }
}

#[test]
fn a_tombstone_is_one_unsuccessful_job_and_the_group_continues() {
    let worker = worker("tombstone-result");
    let mut after = body(JobKind::Compilation, "OutputOnly");
    put(&mut after, JobKey::INFO, json!("after"));
    let answered = execute_job_group(&json!({"jobs": [carried_answer(), after]}), &worker)
        .expect("the tombstone is one result, not a failed group");
    let jobs = answered["jobs"].as_array().expect("the group envelope");
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0]["success"], json!(false));
    assert_eq!(jobs[0]["plus"], json!({"tombstone": true}));
    assert_eq!(jobs[1]["success"], json!(true));
    assert_eq!(jobs[1]["info"], json!("after"));
}

#[test]
fn a_busy_worker_returns_the_reference_sentence() {
    let worker = worker("busy-worker");
    let (running, is_running) = mpsc::channel();
    let (finish, may_finish) = mpsc::channel();
    let service = &worker.service;
    thread::scope(|scope| {
        let holding = scope.spawn(move || {
            let mut jobs = vec![Job {
                task_type: String::from("OutputOnly"),
                body: Map::new(),
            }];
            let mut work = |_task_type: &str, _body: &mut Map<String, Value>| {
                running.send(()).expect("the holding request is running");
                may_finish.recv().expect("the holding request may finish");
                Ok(())
            };
            service.execute_group(&mut jobs, super::system_clock, &mut work)
        });
        let started = is_running.recv_timeout(Duration::from_secs(5));
        let refusal = execute_job_group(&json!({"jobs": []}), &worker)
            .expect_err("a busy worker declines the group");
        finish.send(()).expect("the holding request may finish");
        started.expect("the holding request reached its work");
        holding
            .join()
            .expect("the holding request finished")
            .expect("the holding request ran");
        assert_eq!(
            refusal,
            "Request received, but declined because of acquired lock (Worker is busy executing another job, this should not happen: check if there are more than one ES running, or for bugs in ES."
        );
    });
}

#[test]
fn a_worker_without_precache_refuses_the_call_without_panicking() {
    let worker = worker("precache-unavailable");
    let refusal = precache_files(&json!({"contest_id": 7}), &worker)
        .expect_err("a worker without DATABASE_URL refuses precaching");

    assert!(refusal.contains("DATABASE_URL"), "{refusal}");
}

#[test]
fn a_malformed_contest_id_is_refused_by_name() {
    let worker = worker("precache-malformed-id");
    for data in [
        json!({}),
        json!({"contest_id": null}),
        json!({"contest_id": "7"}),
        json!({"contest_id": 7.5}),
        json!({"contest_id": 2147483648_i64}),
    ] {
        let refusal = precache_files(&data, &worker).expect_err("a malformed id is refused");
        assert!(refusal.contains("contest_id"), "{refusal}");
    }
}

#[test]
fn a_held_precache_lock_answers_null_without_opening_the_database() {
    let dir = workspace("precache-lock-rpc");
    let precache = Precache::new("not-a-database-url", dir.join("tmp"), dir.join("cache"))
        .expect("a shared cache can be opened without connecting");
    let held = precache
        .file_cache()
        .precache_lock()
        .expect("the lock file can be opened")
        .expect("the first lock is taken");
    let worker = worker("precache-lock-rpc-worker").with_precache(precache);

    assert_eq!(
        precache_files(&json!({"contest_id": 7}), &worker),
        Ok(Value::Null)
    );
    drop(held);
}

#[test]
fn the_method_table_keeps_echo_and_quit_beside_the_worker_method() {
    let worker = worker("method-table");
    let methods = Worker::methods();
    let names: Vec<&str> = methods.iter().map(|method| method.name).collect();
    assert_eq!(
        names,
        ["echo", "quit", "execute_job_group", "precache_files"]
    );
    let echo = methods
        .iter()
        .find(|method| method.name == "echo")
        .expect("the base echo method");
    assert_eq!(
        (echo.handler)(&json!({"string": "alive"}), &worker),
        Ok(json!("alive"))
    );
}
