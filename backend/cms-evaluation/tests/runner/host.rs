//! A real `cms-svc` Host whose `execute_job_group` stamps result keys onto
//! every request job, so the runner has realistic bodies to parse.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use cms_proto::{GateConfig, Method};
use cms_svc::{Host, HostError, RunOutcome, Stop};
use serde_json::{json, Map, Value};

/// The method the dispatcher calls.
pub const EXECUTE_METHOD: &str = "execute_job_group";

/// The secret both sides share, so an error can be checked for leaking it.
pub const SECRET: &str = "runner test secret";

/// The argument key that carries the jobs array.
const JOBS_ARGUMENT: &str = "jobs";

/// How one host stamps the `success` result key.
#[derive(Clone, Copy)]
pub enum Reply {
    /// Add `success: true`, `text: ["ok"]` and `plus: {}`.
    Success,
    /// Add `success: "yes"` instead, so the output reader refuses it.
    StringSuccess,
}

/// Context handed to the handler: the scripted answer and a call counter.
pub struct State {
    /// Number of `execute_job_group` calls the handler served.
    pub hits: Arc<AtomicUsize>,
    /// The answer this host is scripted to give.
    pub reply: Reply,
}

/// Stamps the three result keys the runner reads onto one request job.
fn stamp(job: &Value, success: &Value) -> Value {
    let mut object: Map<String, Value> = job
        .as_object()
        .cloned()
        .expect("a request job is a JSON object");
    object.insert("success".to_owned(), success.clone());
    object.insert("text".to_owned(), json!(["ok"]));
    object.insert("plus".to_owned(), json!({}));
    Value::Object(object)
}

/// The one `execute_job_group` handler, reading its behavior from the context.
fn execute(data: &Value, state: &State) -> Result<Value, String> {
    state.hits.fetch_add(1, Ordering::SeqCst);
    let success = match state.reply {
        Reply::Success => json!(true),
        Reply::StringSuccess => json!("yes"),
    };
    let jobs = data
        .get(JOBS_ARGUMENT)
        .and_then(Value::as_array)
        .expect("the request carries a jobs array");
    let returned: Vec<Value> = jobs.iter().map(|job| stamp(job, &success)).collect();
    Ok(json!({ JOBS_ARGUMENT: returned }))
}

/// Builds the method table: base echo/quit plus `execute_job_group`.
fn methods() -> Vec<Method<State>> {
    let mut table = cms_svc::service::methods::<State>();
    table.push(Method {
        name: EXECUTE_METHOD,
        is_callable: true,
        handler: execute,
    });
    table
}

/// A host that is always stopped and joined when dropped.
pub struct TestHost {
    addr: SocketAddr,
    hits: Arc<AtomicUsize>,
    stop: Stop,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl TestHost {
    /// Binds an ephemeral loopback host with the given scripted answer.
    #[must_use]
    pub fn start(reply: Reply, secret: Option<&str>) -> Self {
        let hits = Arc::new(AtomicUsize::new(0));
        let state = State {
            hits: Arc::clone(&hits),
            reply,
        };
        let config = GateConfig {
            secret,
            is_backdoor_enabled: false,
        };
        let host = Host::bind("127.0.0.1:0", methods(), state, config)
            .expect("an ephemeral port is bindable");
        let addr = host
            .local_addr()
            .expect("a bound listener reports its address");
        let stop = host.stop_handle();
        let thread = Some(thread::spawn(move || host.run()));
        Self {
            addr,
            hits,
            stop,
            thread,
        }
    }

    /// The address the kernel picked for this host.
    pub const fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// How many `execute_job_group` calls reached the handler.
    pub fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

impl Drop for TestHost {
    fn drop(&mut self) {
        self.stop.request();
        self.thread
            .take()
            .expect("a host thread is joined once")
            .join()
            .expect("the host thread does not panic")
            .expect("the host stops normally");
    }
}
