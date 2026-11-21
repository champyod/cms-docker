//! Delivery: the one place a finished brief becomes a Discord message.
//!
//! WHY it refuses rather than falls back: a digest that is rendered and silently not sent is the
//! failure mode the Python job kept hiding, so a missing webhook is an error the cron reports.

use std::io::{Read, Write};
use std::net::TcpStream;

/// Discord rejects content over 2000 characters; the margin leaves room for the cut marker.
pub const CONTENT_LIMIT: usize = 1900;

/// What the caller can report without inspecting the transport.
#[derive(Debug)]
pub struct Delivered {
    pub chars: usize,
    pub cut: bool,
    pub status: u16,
}

/// The webhook this job delivers to: an explicit digest URL first, the fleet's channel second.
pub fn webhook_from_env() -> Option<String> {
    for key in ["DIGEST_WEBHOOK_URL", "DISCORD_WEBHOOK_URL"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Cuts on a line boundary so the message never ends mid-word, and says that it was cut.
pub fn fit(text: &str) -> (String, bool) {
    if text.chars().count() <= CONTENT_LIMIT {
        return (text.to_string(), false);
    }
    let marker = "\n… (trimmed)";
    let budget = CONTENT_LIMIT - marker.chars().count();
    let mut kept = String::new();
    for line in text.lines() {
        let next = if kept.is_empty() {
            line.to_string()
        } else {
            format!("{kept}\n{line}")
        };
        if next.chars().count() > budget {
            break;
        }
        kept = next;
    }
    if kept.is_empty() {
        // A single line longer than the budget: cut it, the marker still tells the reader.
        let kept: String = text.chars().take(budget).collect();
        return (format!("{kept}{marker}"), true);
    }
    (format!("{kept}{marker}"), true)
}

/// The JSON body Discord accepts; `serde_json` escapes the text, so no hand-built quoting.
pub fn body(text: &str) -> String {
    serde_json::json!({ "content": text, "allowed_mentions": { "parse": [] } }).to_string()
}

/// Sends the brief and returns what happened; every failure says which part failed.
pub fn deliver(text: &str) -> Result<Delivered, String> {
    let webhook = webhook_from_env().ok_or_else(|| {
        "no webhook configured: set DIGEST_WEBHOOK_URL (or DISCORD_WEBHOOK_URL)".to_string()
    })?;
    if text.trim().is_empty() {
        return Err("refusing to deliver an empty brief".to_string());
    }
    let (content, cut) = fit(text);
    let status = post_json(&webhook, &body(&content))?;
    if !(200..300).contains(&status) {
        return Err(format!("webhook answered HTTP {status}"));
    }
    Ok(Delivered {
        chars: content.chars().count(),
        cut,
        status,
    })
}

/// Minimal POST over `ureq` so delivery shares the crate's existing HTTP dependency.
fn post_json(url: &str, payload: &str) -> Result<u16, String> {
    let response = ureq::post(url)
        .header("content-type", "application/json")
        .header("user-agent", "sec-digest/0.1")
        .send(payload.as_bytes())
        .map_err(|error| format!("webhook request failed: {error}"))?;
    Ok(response.status().as_u16())
}

/// Reads one HTTP request from `stream` and answers 204, for tests that assert the body shape.
pub fn answer_once(stream: &mut TcpStream) -> String {
    let mut buffer = [0u8; 8192];
    let read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
    let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\ncontent-length: 0\r\n\r\n");
    request
}
