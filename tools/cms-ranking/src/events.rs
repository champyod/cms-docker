use std::convert::Infallible;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};
use tokio_stream::wrappers::ReceiverStream;

use crate::feed::{self, RankingEvent};
use crate::AppState;

/// Python pings after a quiet period, so the first tick is a full interval away
/// rather than immediate.
const PING: Duration = Duration::from_secs(15);
/// Python closed every stream after ten minutes; the client's EventSource reconnects
/// on its own, so this is what bounds one subscriber's resource use.
const LIFETIME: Duration = Duration::from_secs(600);
const CHANNEL: usize = 64;

#[derive(Deserialize)]
pub struct EventsQuery {
    pub last_event_id: Option<String>,
}

pub async fn events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> Response {
    if !accepts_event_stream(&headers) {
        return StatusCode::NOT_ACCEPTABLE.into_response();
    }
    let feed = state.feed().clone();
    let receiver = feed.subscribe();
    let replay = match feed.since(last_event_id(&headers, &query).as_deref()) {
        Some(events) => events
            .into_iter()
            .map(|event| Bytes::from(event.frame()))
            .collect(),
        None => vec![Bytes::from_static(feed::REINIT)],
    };
    stream_response(replay, receiver)
}

/// The SSE spec puts the reconnect cursor in a header; the page's polyfill puts it
/// in the query string, and the header wins when both are present.
fn last_event_id(headers: &HeaderMap, query: &EventsQuery) -> Option<String> {
    headers
        .get("Last-Event-ID")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .or_else(|| query.last_event_id.clone())
}

/// Werkzeug treats a missing Accept as accepting everything, so only a list that
/// explicitly excludes the stream is a 406. A media range grants its q value and
/// the most specific matching range wins, so a bare "*/*" cannot override an
/// explicit "text/event-stream; q=0".
fn accepts_event_stream(headers: &HeaderMap) -> bool {
    let Some(value) = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
    else {
        return true;
    };
    let mut best: Option<(u8, f32)> = None;
    for range in value.split(',') {
        let mut parts = range.split(';');
        let media = parts.next().unwrap_or_default().trim();
        let Some(specificity) = media_specificity(media) else {
            continue;
        };
        let quality = parts
            .filter_map(|parameter| parameter.trim().strip_prefix("q="))
            .filter_map(|raw| raw.parse::<f32>().ok())
            .next()
            .unwrap_or(1.0);
        best = match best {
            Some((current, best_quality)) if current > specificity => Some((current, best_quality)),
            Some((current, best_quality)) if current == specificity && best_quality >= quality => {
                Some((current, best_quality))
            }
            _ => Some((specificity, quality)),
        };
    }
    best.is_some_and(|(_, quality)| quality > 0.0)
}

/// How closely a media range names text/event-stream: the exact type first, then
/// the type wildcard, then accept-all. None cannot match it at all.
fn media_specificity(media: &str) -> Option<u8> {
    match media {
        "text/event-stream" => Some(2),
        "text/*" => Some(1),
        "*/*" => Some(0),
        _ => None,
    }
}

fn stream_response(replay: Vec<Bytes>, receiver: broadcast::Receiver<RankingEvent>) -> Response {
    let (sender, out) = mpsc::channel::<Result<Bytes, Infallible>>(CHANNEL);
    tokio::spawn(pump(replay, receiver, sender));
    let body = Body::from_stream(ReceiverStream::new(out));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn pump(
    replay: Vec<Bytes>,
    mut receiver: broadcast::Receiver<RankingEvent>,
    sender: mpsc::Sender<Result<Bytes, Infallible>>,
) {
    if send(&sender, Bytes::from_static(feed::COMMENT))
        .await
        .is_err()
    {
        return;
    }
    for chunk in replay {
        if send(&sender, chunk).await.is_err() {
            return;
        }
    }
    let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + PING, PING);
    let deadline = tokio::time::sleep(LIFETIME);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => return,
            event = receiver.recv() => match event {
                Ok(event) => {
                    if send(&sender, Bytes::from(event.frame())).await.is_err() {
                        return;
                    }
                }
                // A subscriber that fell behind cannot be told what it missed, so
                // the connection ends and the client's reconnect, carrying a
                // Last-Event-ID, is the one path allowed to ask for a reinit.
                Err(broadcast::error::RecvError::Lagged(_)) => return,
                Err(broadcast::error::RecvError::Closed) => return,
            },
            _ = ping.tick() => {
                if send(&sender, Bytes::from_static(feed::COMMENT)).await.is_err() {
                    return;
                }
            }
        }
    }
}

async fn send(
    sender: &mpsc::Sender<Result<Bytes, Infallible>>,
    chunk: Bytes,
) -> Result<(), mpsc::error::SendError<Result<Bytes, Infallible>>> {
    sender.send(Ok(chunk)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn accept(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ACCEPT,
            HeaderValue::from_str(value).expect("a header value"),
        );
        headers
    }

    #[test]
    fn a_client_that_asks_for_the_stream_is_served() {
        assert!(accepts_event_stream(&accept("text/event-stream")));
        assert!(accepts_event_stream(&accept("text/event-stream; q=0.4")));
        assert!(accepts_event_stream(&accept("*/*")));
        assert!(accepts_event_stream(&accept("text/*, application/json")));
    }

    #[test]
    fn a_client_that_excludes_the_stream_is_refused() {
        assert!(!accepts_event_stream(&accept("application/json")));
        assert!(!accepts_event_stream(&accept("text/event-stream; q=0")));
        assert!(!accepts_event_stream(&accept("*/*; q=0")));
        // The exact range is more specific, so a wildcard cannot re-admit it.
        assert!(!accepts_event_stream(&accept(
            "text/event-stream; q=0, */*; q=1"
        )));
    }

    #[test]
    fn a_missing_accept_is_not_a_refusal() {
        assert!(accepts_event_stream(&HeaderMap::new()));
    }
}
