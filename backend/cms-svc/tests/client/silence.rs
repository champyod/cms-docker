//! A worker that accepts a request and never answers.
//!
//! The reference disables a worker with no sign of life for `WORKER_TIMEOUT`
//! (`src/cms/service/workerpool.py:64`) rather than waiting for ever. The
//! client enforces the same bound as a socket read deadline, so a silent peer
//! must surface as a failed call and not a blocked caller.

use std::io::Read;
use std::net::{SocketAddr, TcpListener};
use std::thread;
use std::time::{Duration, Instant};

use cms_svc::{Client, ClientError, READ_TIMEOUT};
use serde_json::json;

/// A deadline short enough for a test, and how much later an answer may still
/// count as "cut off on time". The silent listener holds its socket open far
/// past this, so a call that waits for the close instead of the deadline fails.
const TEST_TIMEOUT: Duration = Duration::from_millis(200);
const SLACK: Duration = Duration::from_secs(1);

/// How long the silent listener keeps the socket open: well past the deadline
/// and its slack, so waiting for the close instead of the deadline is a failure.
const HOLD: Duration = Duration::from_secs(3);

#[test]
fn a_silent_worker_fails_the_call_instead_of_blocking_for_ever() {
    let (addr, listener) = silent_listener();
    let mut client = Client::connect_with_timeout(addr, None, TEST_TIMEOUT)
        .expect("the client reaches the silent listener");

    let started = Instant::now();
    let error = client
        .call("queue_status", json!({}))
        .expect_err("a reply that never arrives is an error");
    let waited = started.elapsed();
    drop(listener);

    assert!(
        matches!(error, ClientError::Read(_)),
        "a silent peer is a read failure, got {error:?}"
    );
    assert!(
        waited >= TEST_TIMEOUT && waited < TEST_TIMEOUT + SLACK,
        "the call waited {waited:?}, which is not the {TEST_TIMEOUT:?} deadline"
    );
}

#[test]
fn the_configured_deadline_matches_the_reference_worker_timeout() {
    assert_eq!(
        READ_TIMEOUT,
        Duration::from_secs(600),
        "the reference disables a worker after 600s of silence"
    );
}

/// Starts a listener that reads one request, answers nothing, and holds the
/// socket open past the client's deadline.
fn silent_listener() -> (SocketAddr, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("an ephemeral port is bindable");
    let addr = listener
        .local_addr()
        .expect("a bound listener has an address");
    let thread = thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        // Drain the request so the client waits on a reply, not on a write, and
        // then stay silent while holding the socket open.
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        thread::sleep(HOLD);
        drop(stream);
    });
    (addr, thread)
}
