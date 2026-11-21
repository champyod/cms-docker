use std::io::Write;
use std::net::TcpListener;
use std::sync::{Mutex, MutexGuard};

use sec_digest::deliver::{body, fit, webhook_from_env, CONTENT_LIMIT};

/// The webhook vars are process-wide while tests run in parallel, so each test takes them alone.
static ENV: Mutex<()> = Mutex::new(());

fn env_lock() -> MutexGuard<'static, ()> {
    ENV.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A listener that answers one request and hands back what it received.
fn one_shot(reply: &'static str) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let url = format!("http://{}/hook", listener.local_addr().expect("addr"));
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buffer = [0u8; 16384];
        let read = std::io::Read::read(&mut stream, &mut buffer).unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]).to_string();
        let _ = stream.write_all(reply.as_bytes());
        request
    });
    (url, handle)
}

#[test]
fn a_brief_that_fits_is_sent_whole() {
    let (text, cut) = fit("scan: clean");
    assert_eq!(text, "scan: clean");
    assert!(!cut);
}

#[test]
fn a_brief_over_the_cap_is_cut_on_a_line_and_says_so() {
    let line = "x".repeat(120);
    let long = std::iter::repeat_n(line, 40).collect::<Vec<_>>().join("\n");
    let (text, cut) = fit(&long);
    assert!(cut, "a 4800-char brief must be cut");
    assert!(text.chars().count() <= CONTENT_LIMIT, "stays under the cap");
    assert!(text.ends_with("… (trimmed)"), "the reader is told it was cut");
    assert!(text.starts_with(&"x".repeat(120)), "the head is what survives");
}

#[test]
fn one_unbreakable_line_is_cut_rather_than_dropped() {
    let long = "y".repeat(CONTENT_LIMIT + 500);
    let (text, cut) = fit(&long);
    assert!(cut);
    assert!(text.chars().count() <= CONTENT_LIMIT);
}

#[test]
fn the_body_is_json_with_mentions_disabled() {
    let value: serde_json::Value = serde_json::from_str(&body("hello \"world\"")).expect("json");
    assert_eq!(value["content"], "hello \"world\"");
    assert_eq!(value["allowed_mentions"]["parse"], serde_json::json!([]));
}

#[test]
fn delivery_reports_the_status_the_webhook_answered() {
    let _env = env_lock();
    let (url, handle) = one_shot("HTTP/1.1 204 No Content\r\ncontent-length: 0\r\n\r\n");
    std::env::set_var("DIGEST_WEBHOOK_URL", &url);
    let sent = sec_digest::deliver::deliver("a brief").expect("delivered");
    assert_eq!(sent.status, 204);
    assert!(!sent.cut);
    let request = handle.join().expect("thread");
    assert!(request.starts_with("POST /hook"), "posts to the hook path");
    assert!(request.to_lowercase().contains("content-type: application/json"));
    std::env::remove_var("DIGEST_WEBHOOK_URL");
}

#[test]
fn a_missing_webhook_is_an_error_not_a_silent_skip() {
    let _env = env_lock();
    std::env::remove_var("DIGEST_WEBHOOK_URL");
    std::env::remove_var("DISCORD_WEBHOOK_URL");
    assert!(webhook_from_env().is_none());
    let error = sec_digest::deliver::deliver("a brief").expect_err("must refuse");
    assert!(error.contains("no webhook configured"), "got {error}");
}

#[test]
fn an_empty_brief_is_refused_before_any_request() {
    let _env = env_lock();
    std::env::set_var("DIGEST_WEBHOOK_URL", "http://127.0.0.1:9/hook");
    let error = sec_digest::deliver::deliver("   \n ").expect_err("must refuse");
    assert!(error.contains("empty brief"), "got {error}");
    std::env::remove_var("DIGEST_WEBHOOK_URL");
}
