//! What a report says about a service that is running, one that is gone, and one never seen.

use serde_json::json;

use super::{build, local, process, FakeReader, MEBIBYTE};

const LOG_SERVICE: &str = "LogService,0";

fn log_service_process(user_cpu_seconds: f64, create_time: f64) -> cms_svc::ProcessFacts {
    process(
        7,
        &[&format!("{}/cms-log-service", super::BIN), "0"],
        user_cpu_seconds,
        1.0,
        MEBIBYTE,
        create_time,
    )
}

#[test]
fn a_vanished_process_reports_stopped_without_stale_figures() {
    let reader = FakeReader::new();
    reader.put_process(log_service_process(1.0, 90.0));
    let mut service = build(&reader, vec![local("LogService", 0)], true, Some(1));
    service.prime(100.0).expect("the fake reader answers");

    let running = service
        .sample(102.0)
        .expect("two seconds elapsed")
        .to_json();
    assert_eq!(running["services"][LOG_SERVICE]["running"], json!(true));
    assert_eq!(running["services"][LOG_SERVICE]["resident"], json!(1));

    reader.remove_process(7);
    let stopped = service
        .sample(104.0)
        .expect("two seconds elapsed")
        .to_json();
    let entry = stopped["services"][LOG_SERVICE]
        .as_object()
        .expect("a service entry is an object");

    assert_eq!(entry["running"], json!(false));
    assert_eq!(entry["autorestart"], json!(true));
    assert_eq!(entry.len(), 2);
    for figure in ["since", "resident", "virtual", "user", "sys", "threads"] {
        assert!(!entry.contains_key(figure), "{figure} outlived the process");
    }
}

#[test]
fn a_service_with_no_process_reports_stopped_at_once() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], true, Some(1));
    service.prime(100.0).expect("the fake reader answers");

    let json = service
        .sample(102.0)
        .expect("two seconds elapsed")
        .to_json();

    assert_eq!(
        json["services"][LOG_SERVICE],
        json!({"autorestart": true, "running": false})
    );
}

#[test]
fn looking_again_finds_a_process_that_started_after_a_stopped_sample() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);
    service.prime(100.0).expect("the fake reader answers");
    assert_eq!(
        service.sample(102.0).expect("two seconds elapsed").services[&local("LogService", 0).coord]
            .state,
        cms_svc::ServiceState::Stopped
    );

    reader.put_process(log_service_process(1.0, 90.0));
    let sample = service.sample(104.0).expect("two seconds elapsed");
    let usage = &sample.services[&local("LogService", 0).coord];

    assert_eq!(usage.autorestart, None);
    assert_eq!(
        usage.state,
        cms_svc::ServiceState::Running(cms_svc::ServiceFigures {
            since: 14.0,
            resident_megabytes: 1,
            virtual_megabytes: 4,
            user: 0,
            sys: 0,
            threads: 3,
        })
    );
}
