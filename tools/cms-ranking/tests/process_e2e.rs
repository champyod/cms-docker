//! End-to-end checks that need no database, no Redis and no browser: the binary is
//! started as a process, its port is dialled, and the answers are read back over HTTP.
//! Everything above this file tests a router in the same process; this is the only place
//! the shipped binary boots.

use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// An ephemeral port, released before the child binds it. The race is bounded by the
/// child failing to bind, which the readiness poll reports as a failure rather than a
/// hang.
fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("an ephemeral port is available");
    listener.local_addr().expect("the port is known").port()
}

/// Starts the shipped binary with a clean environment plus the pairs the test needs, so a
/// variable set on the machine running the suite cannot change the outcome.
fn spawn(bind: &str, extra: &[(&str, &str)]) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_cms-ranking"));
    command
        .env("RANKING_BIND_ADDRESS", bind)
        // Paths that do not exist, so a route refuses rather than serving whatever sits
        // at the default location on this machine.
        .env("RANKING_STATIC_DIR", "/nonexistent-ranking-static")
        .env("CMS_CREDITS_FILE", "/nonexistent-credits.json")
        .env("RANKING_SESSION_SECRET", "test-secret")
        .env_remove("DATABASE_URL")
        .env_remove("RANKING_REDIS_URL")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (name, value) in extra {
        command.env(name, value);
    }
    command.spawn().expect("the binary starts")
}

async fn wait_for_port(port: u16, child: &mut Child) -> bool {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

async fn status(client: &reqwest::Client, url: &str) -> u16 {
    client
        .get(url)
        .send()
        .await
        .unwrap_or_else(|error| panic!("{url} answered nothing: {error}"))
        .status()
        .as_u16()
}

fn stop(mut child: Child) {
    child.kill().ok();
    child.wait().ok();
}

#[tokio::test]
async fn the_shipped_binary_boots_and_refuses_everything_without_a_database() {
    let port = free_port();
    let mut child = spawn(&format!("127.0.0.1:{port}"), &[]);
    assert!(
        wait_for_port(port, &mut child).await,
        "the binary binds its port"
    );
    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");
    for route in [
        "/healthz", "/scores", "/history", "/config", "/", "/logo", "/credits",
    ] {
        assert_eq!(
            status(&client, &format!("{base}{route}")).await,
            503,
            "{route} must refuse rather than answer without state"
        );
    }
    // The sign-in page is the exception: an operator must reach it while everything else
    // is refusing.
    assert_eq!(status(&client, &format!("{base}/login")).await, 200);
    stop(child);
}

#[tokio::test]
async fn an_unreachable_database_refuses_instead_of_hanging() {
    let port = free_port();
    let mut child = spawn(
        &format!("127.0.0.1:{port}"),
        &[("DATABASE_URL", "postgres://nobody@127.0.0.1:1/none")],
    );
    assert!(
        wait_for_port(port, &mut child).await,
        "the binary binds its port"
    );
    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");
    // The pool is lazy, so binding succeeds and the refusal happens at the query.
    assert_eq!(status(&client, &format!("{base}/healthz")).await, 503);
    assert_eq!(status(&client, &format!("{base}/scores")).await, 503);
    stop(child);
}

#[tokio::test]
async fn the_events_stream_is_gated_with_the_rest_without_a_database() {
    let port = free_port();
    let mut child = spawn(&format!("127.0.0.1:{port}"), &[]);
    assert!(
        wait_for_port(port, &mut child).await,
        "the binary binds its port"
    );
    let client = reqwest::Client::new();
    // The gate reads access_mode before it will serve anything, so a stream is refused for
    // the same reason a scoreboard is. The streaming path itself is covered by the
    // database-backed rehearsal, which needs a stack.
    let response = client
        .get(format!("http://127.0.0.1:{port}/events"))
        .send()
        .await
        .expect("the stream route answers");
    assert_eq!(response.status().as_u16(), 503);
    stop(child);
}

/// The security-critical path: a console that cannot count failures must not accept one.
#[tokio::test]
async fn a_login_without_a_counter_store_is_refused_and_sets_no_cookie() {
    let port = free_port();
    let mut child = spawn(&format!("127.0.0.1:{port}"), &[]);
    assert!(
        wait_for_port(port, &mut child).await,
        "the binary binds its port"
    );
    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://127.0.0.1:{port}/login"))
        .form(&[("username", "operator"), ("password", "secret")])
        .send()
        .await
        .expect("the login route answers");
    assert_eq!(
        response.status().as_u16(),
        503,
        "no counters means no login"
    );
    assert!(
        response.headers().get("set-cookie").is_none(),
        "a refused login must not hand out a session"
    );
    stop(child);
}

#[tokio::test]
async fn an_unreachable_counter_store_also_refuses_a_login() {
    let port = free_port();
    let mut child = spawn(
        &format!("127.0.0.1:{port}"),
        &[("RANKING_REDIS_URL", "redis://127.0.0.1:1")],
    );
    assert!(
        wait_for_port(port, &mut child).await,
        "the binary binds its port"
    );
    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://127.0.0.1:{port}/login"))
        .form(&[("username", "operator"), ("password", "secret")])
        .send()
        .await
        .expect("the login route answers");
    // The counter connection fails at start-up, so the service holds no counter at all and
    // refuses: an unreachable store is not a reason to let a guess through.
    assert_eq!(response.status().as_u16(), 503);
    stop(child);
}
