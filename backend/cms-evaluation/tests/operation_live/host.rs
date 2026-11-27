//! Real `cms-svc` hosts: a scripted worker and a counting ScoringService.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use cms_proto::{GateConfig, Method};
use cms_svc::{Host, HostError, RunOutcome, Stop};
use serde_json::{json, Map, Value};

pub const SECRET: &str = "operation test secret";

/// What the worker stamps onto every returned job body.
#[derive(Clone, Copy)]
pub enum Reply {
    /// The box worked and the source compiled.
    CompilationSuccess,
    /// The box worked but the source was rejected.
    CompilationFailure,
    /// The box worked and the grader accepted the testcase.
    EvaluationSuccess,
    /// The box itself failed, so the operation owes a retry.
    WorkerFailure,
}

/// The arguments of the one ScoringService notification this test observes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    /// `new_evaluation.submission_id`.
    pub submission_id: i32,
    /// `new_evaluation.dataset_id`.
    pub dataset_id: i32,
}

/// Stamps the result keys the parser and mapper read onto one request job.
fn stamp(job: &Value, reply: Reply) -> Value {
    let mut object: Map<String, Value> = job
        .as_object()
        .cloned()
        .expect("a request job is a JSON object");
    match reply {
        Reply::CompilationSuccess => {
            object.insert("success".to_owned(), json!(true));
            object.insert("compilation_success".to_owned(), json!(true));
            object.insert("text".to_owned(), json!(["compiled"]));
            object.insert("plus".to_owned(), json!({"stdout": "ok"}));
            object.insert(
                "executables".to_owned(),
                json!({"solution": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}),
            );
        }
        Reply::CompilationFailure => {
            object.insert("success".to_owned(), json!(true));
            object.insert("compilation_success".to_owned(), json!(false));
        }
        Reply::EvaluationSuccess => {
            object.insert("success".to_owned(), json!(true));
            object.insert("outcome".to_owned(), json!("ok"));
            object.insert("text".to_owned(), json!(["Correct"]));
        }
        Reply::WorkerFailure => {
            object.insert("success".to_owned(), json!(false));
        }
    }
    Value::Object(object)
}

/// State behind the scripted `execute_job_group` method.
struct WorkerState {
    reply: Reply,
    hits: Arc<AtomicUsize>,
}

fn execute(data: &Value, state: &WorkerState) -> Result<Value, String> {
    state.hits.fetch_add(1, Ordering::SeqCst);
    let jobs = data
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or_else(|| "execute_job_group requires jobs".to_owned())?;
    let returned: Vec<Value> = jobs.iter().map(|job| stamp(job, state.reply)).collect();
    Ok(json!({ "jobs": returned }))
}

fn worker_methods() -> Vec<Method<WorkerState>> {
    let mut table = cms_svc::service::methods::<WorkerState>();
    table.push(Method {
        name: "execute_job_group",
        is_callable: true,
        handler: execute,
    });
    table
}

/// A worker host that always stops and joins when dropped.
pub struct WorkerHost {
    addr: SocketAddr,
    hits: Arc<AtomicUsize>,
    stop: Stop,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl WorkerHost {
    /// Starts one loopback worker with the given scripted reply.
    pub fn start(reply: Reply) -> Self {
        let hits = Arc::new(AtomicUsize::new(0));
        let state = WorkerState {
            reply,
            hits: Arc::clone(&hits),
        };
        let host = Host::bind(
            "127.0.0.1:0",
            worker_methods(),
            state,
            GateConfig {
                secret: Some(SECRET),
                is_backdoor_enabled: false,
            },
        )
        .expect("a loopback worker binds");
        let addr = host.local_addr().expect("the worker reports its address");
        let stop = host.stop_handle();
        let thread = Some(thread::spawn(move || host.run()));
        Self {
            addr,
            hits,
            stop,
            thread,
        }
    }

    /// The address the dispatcher dials.
    pub const fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// How many job groups were dispatched.
    pub fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

impl Drop for WorkerHost {
    fn drop(&mut self) {
        self.stop.request();
        self.thread
            .take()
            .expect("a host thread is joined once")
            .join()
            .expect("the worker thread does not panic")
            .expect("the worker stops normally");
    }
}

/// State behind the counting `new_evaluation` method.
#[derive(Default)]
struct ScoringState {
    calls: Arc<Mutex<Vec<Notification>>>,
}

fn new_evaluation(data: &Value, state: &ScoringState) -> Result<Value, String> {
    let call = Notification {
        submission_id: data
            .get("submission_id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "new_evaluation requires submission_id".to_owned())?
            as i32,
        dataset_id: data
            .get("dataset_id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "new_evaluation requires dataset_id".to_owned())?
            as i32,
    };
    state
        .calls
        .lock()
        .expect("the call log is usable")
        .push(call);
    Ok(Value::Null)
}

fn scoring_methods() -> Vec<Method<ScoringState>> {
    let mut table = cms_svc::service::methods::<ScoringState>();
    table.push(Method {
        name: "new_evaluation",
        is_callable: true,
        handler: new_evaluation,
    });
    table
}

/// A ScoringService host that records every notification it receives.
pub struct ScoringHost {
    addr: SocketAddr,
    calls: Arc<Mutex<Vec<Notification>>>,
    stop: Stop,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl ScoringHost {
    /// Starts one loopback scoring host.
    pub fn start() -> Self {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let state = ScoringState {
            calls: Arc::clone(&calls),
        };
        let host = Host::bind(
            "127.0.0.1:0",
            scoring_methods(),
            state,
            GateConfig {
                secret: Some(SECRET),
                is_backdoor_enabled: false,
            },
        )
        .expect("a loopback scoring host binds");
        let addr = host.local_addr().expect("the host reports its address");
        let stop = host.stop_handle();
        let thread = Some(thread::spawn(move || host.run()));
        Self {
            addr,
            calls,
            stop,
            thread,
        }
    }

    /// The address the evaluation daemon dials.
    pub const fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// The notifications received, in call order.
    pub fn calls(&self) -> Vec<Notification> {
        self.calls.lock().expect("the call log is usable").clone()
    }
}

impl Drop for ScoringHost {
    fn drop(&mut self) {
        self.stop.request();
        self.thread
            .take()
            .expect("a host thread is joined once")
            .join()
            .expect("the scoring thread does not panic")
            .expect("the scoring host stops normally");
    }
}
