//! End-to-end checks that need no database, no Redis and no browser: the binary is
//! started as a process, its port is dialled, and the refusals are read back over
//! HTTP. Everything above this file tests a router in the same process; this is the
//! only place the shipped binary boots.

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

fn spawn(bind: &str, database_url: Option<&str>) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_cms-ranking"));
    command
        .env("RANKING_BIND_ADDRESS", bind)
        // A path that does not exist, so the page route refuses rather than serving
        // whatever happens to sit at the default location on this machine.
        .env("RANKING_STATIC_DIR", "/nonexistent-ranking-static")
        .env("CMS_CREDITS_FILE", "/nonexistent-credits.json")
        .env_remove("DATABASE_URL")
        .env_remove("RANKING_REDIS_URL")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(url) = database_url {
        command.env("DATABASE_URL", url);
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
    let mut child = spawn(&format!("127.0.0.1:{port}"), None);
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
    // The sign-in page is the exception: an operator must be able to reach it while
    // the service is otherwise refusing everything.
    assert_eq!(status(&client, &format!("{base}/login")).await, 200);
    stop(child);
}

#[tokio::test]
async fn an_unreachable_database_refuses_instead_of_hanging() {
    let port = free_port();
    let mut child = spawn(
        &format!("127.0.0.1:{port}"),
        Some("postgres://nobody@127.0.0.1:1/none"),
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
    let mut child = spawn(&format!("127.0.0.1:{port}"), None);
    assert!(
        wait_for_port(port, &mut child).await,
        "the binary binds its port"
    );
    let client = reqwest::Client::new();
    // The gate reads access_mode before it will serve anything, so a stream is refused
    // for the same reason a scoreboard is: without the row there is no way to know
    // whether this deployment is public. The streaming path itself is covered by the
    // database-backed rehearsal, which needs a stack.
    let response = client
        .get(format!("http://127.0.0.1:{port}/events"))
        .send()
        .await
        .expect("the stream route answers");
    assert_eq!(response.status().as_u16(), 503);
    stop(child);
}
