//! The line `DetailedFormatter` draws, pinned to the output `src/cms/log.py` gave.
//!
//! The expected strings were generated once from the repository root with
//!
//! ```text
//! CMS_CONFIG=<a config whose web_server.secret_key is not the shipped default> \
//!   PYTHONPATH=src TZ=UTC0 python3 backend/cms-svc/tests/log/expected.py
//! ```
//!
//! and pasted below byte for byte; the script builds each `logging.LogRecord`
//! with `logging.makeLogRecord` and formats it with `DetailedFormatter(False)`.
//! Nothing here shells out to Python.

use cms_svc::{FormatterSettings, Record};
use serde_json::{json, Value};

/// The zone the container runs in, which is the zone the expected strings were made under.
const UTC: FormatterSettings = FormatterSettings::UTC;

/// The line the formatter draws for one `Log` argument object.
fn line(data: Value) -> String {
    Record::from_json(&data)
        .expect("the fixture is a well-formed record")
        .format(UTC)
}

/// A record with no service pair prints the unknown coordinates, then the thread, file and function.
#[test]
fn a_debug_record_without_service_coordinates_says_unknown() {
    assert_eq!(
        line(json!({
            "msg": "worker cache warmed",
            "levelname": "DEBUG",
            "levelno": 10,
            "created": 1_700_000_000.125,
            "msecs": 125.0,
            "filename": "worker.py",
            "funcName": "run",
            "threadName": "MainThread",
        })),
        "2023-11-14 22:13:20,125 - DEBUG [<unknown> Main worker::run] worker cache warmed"
    );
}

/// An info record whose service name carries a class suffix the formatter drops.
#[test]
fn an_info_record_shortens_its_service_name() {
    assert_eq!(
        line(json!({
            "msg": "contest started",
            "levelname": "INFO",
            "levelno": 20,
            "created": 1_700_000_001.5,
            "msecs": 500.0,
            "service_name": "ContestWebServer",
            "service_shard": 0,
            "filename": "contest.py",
            "funcName": "start",
            "threadName": "MainThread",
        })),
        "2023-11-14 22:13:21,500 - INFO [Contest,0 Main contest::start] contest started"
    );
}

/// Both halves of the service pair reach the line, and a thread name loses its own suffix.
#[test]
fn a_warning_with_both_coordinates_names_its_thread() {
    assert_eq!(
        line(json!({
            "msg": "submission queue is long",
            "levelname": "WARNING",
            "levelno": 30,
            "created": 1_700_000_002.25,
            "msecs": 250.0,
            "service_name": "WorkerService",
            "service_shard": 3,
            "filename": "worker.py",
            "funcName": "run",
            "threadName": "WorkerThread-1",
        })),
        "2023-11-14 22:13:22,250 - WARNING [Worker,3 Worker-1 worker::run] \
         submission queue is long"
    );
}

/// Half a service pair is not a pair: the coordinates stay unknown.
#[test]
fn a_warning_with_only_a_service_name_says_unknown() {
    assert_eq!(
        line(json!({
            "msg": "peer is slow",
            "levelname": "WARNING",
            "levelno": 30,
            "created": 1_700_000_003.75,
            "msecs": 750.0,
            "service_name": "ProxyService",
            "filename": "proxy.py",
            "funcName": "forward",
            "threadName": "MainThread",
        })),
        "2023-11-14 22:13:23,750 - WARNING [<unknown> Main proxy::forward] peer is slow"
    );
}

/// The operation gets its own bracket, after the coordinates.
#[test]
fn an_operation_gets_its_own_bracket() {
    assert_eq!(
        line(json!({
            "msg": "decoding submission 7",
            "levelname": "WARNING",
            "levelno": 30,
            "created": 1_700_000_004.5,
            "msecs": 500.0,
            "service_name": "ScoringService",
            "service_shard": 1,
            "operation": "load submission",
            "filename": "score.py",
            "funcName": "score",
            "threadName": "MainThread",
        })),
        "2023-11-14 22:13:24,500 - WARNING [Scoring,1 Main score::score] [load submission] \
         decoding submission 7"
    );
}

/// The exception's text follows the line on the next line, not after a space.
#[test]
fn exception_text_follows_the_line_after_a_newline() {
    assert_eq!(
        line(json!({
            "msg": "cannot read the inbox",
            "levelname": "ERROR",
            "levelno": 40,
            "created": 1_700_000_005.125,
            "msecs": 125.0,
            "service_name": "ResourceService",
            "service_shard": 2,
            "filename": "resource.py",
            "funcName": "check",
            "threadName": "MainThread",
            "exc_text": "Traceback (most recent call last):\n  File \"resource.py\", line 7, in check\nKeyError: 'inbox'",
        })),
        "2023-11-14 22:13:25,125 - ERROR [Resource,2 Main resource::check] \
         cannot read the inbox\nTraceback (most recent call last):\n  \
         File \"resource.py\", line 7, in check\nKeyError: 'inbox'"
    );
}

/// The same record printed seven hours ahead, the offset the formatter is handed.
#[test]
fn the_zone_offset_moves_the_printed_clock() {
    let settings = FormatterSettings {
        utc_offset_seconds: 25_200,
    };
    let record = Record::from_json(&json!({
        "msg": "contest started",
        "levelname": "INFO",
        "levelno": 20,
        "created": 1_700_000_001.5,
        "msecs": 500.0,
        "service_name": "ContestWebServer",
        "service_shard": 0,
        "filename": "contest.py",
        "funcName": "start",
        "threadName": "MainThread",
    }))
    .expect("the fixture is a well-formed record");

    assert_eq!(
        record.format(settings),
        "2023-11-15 05:13:21,500 - INFO [Contest,0 Main contest::start] contest started"
    );
}

/// A record that carries no msecs takes them from the fraction of `created`, as `LogRecord` does.
#[test]
fn a_record_without_msecs_takes_them_from_created() {
    assert_eq!(
        line(json!({
            "msg": "worker cache warmed",
            "levelname": "DEBUG",
            "levelno": 10,
            "created": 1_700_000_000.125,
        })),
        "2023-11-14 22:13:20,125 - DEBUG [<unknown> Main ::None] worker cache warmed"
    );
}
