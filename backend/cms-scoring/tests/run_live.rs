//! The scoring daemon's sweeper and serial worker against a real database.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-scoring --test run_live

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cms_proto::{GateConfig, Method};
use cms_scoring::api::Scoring;
use cms_scoring::run::{sweep_once, worker};
use cms_svc::{Host, HostError, RunOutcome, Stop};
use serde_json::{json, Value};

#[path = "support/service_db.rs"]
mod service_db;
#[path = "support/service_schema.rs"]
mod service_schema;

use service_db::Fixture;

const SECRET: &str = "scoring proxy test secret";
const TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::test]
async fn sweep_once_enqueues_an_unscored_result_from_the_database() {
    let fixture = Fixture::required("scoring_run_sweep").await;
    fixture.seed_result(41, at(1), ["1.5", "0.5"]).await;
    let scoring = context(&fixture, None);

    assert_eq!(
        sweep_once(&scoring)
            .await
            .expect("the immediate sweep reads the candidate"),
        1
    );
    assert_eq!(scoring.queue_len(), 1);
}

#[tokio::test]
async fn worker_scores_one_candidate_and_notifies_the_active_proxy() {
    let fixture = Fixture::required("scoring_run_worker").await;
    fixture.seed_result(41, at(1), ["1.5", "0.5"]).await;
    let mut proxy = Proxy::start(false);
    let scoring = context(&fixture, Some(proxy.address()));
    cms_scoring::api::new_evaluation(&json!({"submission_id": 41, "dataset_id": 9}), &scoring)
        .expect("the worker receives one candidate");
    let stop = Stop::new();

    let submission = worker_until_notification(&mut proxy, scoring, stop).await;

    assert_eq!(submission, 41);
    assert_scored(&fixture.stored_score(41).await);
}

#[tokio::test]
async fn worker_keeps_a_committed_score_when_the_proxy_refuses_it() {
    let fixture = Fixture::required("scoring_run_proxy_refusal").await;
    fixture.seed_result(41, at(1), ["1.5", "0.5"]).await;
    let mut proxy = Proxy::start(true);
    let scoring = context(&fixture, Some(proxy.address()));
    cms_scoring::api::new_evaluation(&json!({"submission_id": 41, "dataset_id": 9}), &scoring)
        .expect("the worker receives one candidate");
    let stop = Stop::new();

    let submission = worker_until_notification(&mut proxy, scoring, stop).await;

    assert_eq!(submission, 41);
    assert_scored(&fixture.stored_score(41).await);
}

fn context(fixture: &Fixture, proxy: Option<String>) -> Arc<Scoring> {
    Arc::new(Scoring::new(
        fixture.shared_session(),
        tokio::runtime::Handle::current(),
        proxy,
        Some(SECRET.to_owned()),
    ))
}

async fn worker_until_notification(proxy: &mut Proxy, scoring: Arc<Scoring>, stop: Stop) -> i32 {
    let receiver = proxy
        .receiver
        .take()
        .expect("the proxy observer is present");
    let task = tokio::spawn(worker(scoring, stop.clone()));
    let observed = tokio::task::spawn_blocking(move || receiver.recv_timeout(TIMEOUT))
        .await
        .expect("the proxy observer thread finishes");
    stop.request();
    tokio::time::timeout(TIMEOUT, task)
        .await
        .expect("the worker observes the test stop")
        .expect("the worker exits cleanly")
        .expect("the worker loop has no queue failure");
    observed.expect("the committed score reaches ProxyService")
}

fn assert_scored(stored: &service_db::StoredScore) {
    assert_eq!(stored.score, Some(2.0));
    assert!(stored.score_details.is_some());
    assert_eq!(stored.public_score, Some(1.5));
    assert!(stored.public_score_details.is_some());
    assert_eq!(stored.ranking_score_details, Some(Vec::new()));
    assert!(stored.scored_at.is_some());
}

fn at(second: u32) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

struct Proxy {
    address: String,
    stop: Stop,
    receiver: Option<Receiver<i32>>,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl Proxy {
    fn start(refuse: bool) -> Self {
        let (sender, receiver) = sync_channel(1);
        let methods = vec![Method {
            name: "submission_scored",
            is_callable: true,
            handler: submission_scored,
        }];
        let host = Host::bind(
            "127.0.0.1:0",
            methods,
            Observer { sender, refuse },
            GateConfig {
                secret: Some(SECRET),
                is_backdoor_enabled: false,
            },
        )
        .expect("the proxy observer can bind");
        let address = host.local_addr().expect("the proxy reports its address");
        let stop = host.stop_handle();
        let thread = thread::spawn(move || host.run());
        Self {
            address: address.to_string(),
            stop,
            receiver: Some(receiver),
            thread: Some(thread),
        }
    }

    fn address(&self) -> String {
        self.address.clone()
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.stop.request();
        self.thread
            .take()
            .expect("the proxy thread is joined once")
            .join()
            .expect("the proxy thread does not panic")
            .expect("the proxy host stops normally");
    }
}

struct Observer {
    sender: SyncSender<i32>,
    refuse: bool,
}

fn submission_scored(data: &Value, observer: &Observer) -> Result<Value, String> {
    let submission_id = data
        .get("submission_id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "submission_scored() requires an integer `submission_id`".to_owned())?;
    observer
        .sender
        .send(i32::try_from(submission_id).map_err(|_| "submission id is out of range".to_owned())?)
        .map_err(|_| "the proxy observer disconnected".to_owned())?;
    if observer.refuse {
        Err("proxy refused the score notification".to_owned())
    } else {
        Ok(Value::Null)
    }
}
