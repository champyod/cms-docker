//! The flag `toggle_autorestart` flips, and the three answers Python gives before flipping.

use cms_svc::ResourceError;

use super::{build, local, FakeReader};
use serde_json::json;

const LOG_SERVICE: &str = "LogService,0";

#[test]
fn toggling_flips_the_flag_and_the_next_sample_reports_it() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], true, Some(5));
    service.prime(100.0).expect("the fake reader answers");

    assert_eq!(
        service
            .toggle_autorestart(LOG_SERVICE)
            .expect("a local service"),
        Some(false)
    );
    let json = service
        .sample(102.0)
        .expect("two seconds elapsed")
        .to_json();
    assert_eq!(json["services"][LOG_SERVICE]["autorestart"], json!(false));

    assert_eq!(
        service
            .toggle_autorestart(LOG_SERVICE)
            .expect("a local service"),
        Some(true)
    );
}

#[test]
fn a_service_without_autorestart_never_flips() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);

    assert_eq!(
        service
            .toggle_autorestart(LOG_SERVICE)
            .expect("a local service"),
        None
    );
}

#[test]
fn the_proxy_is_left_alone_without_a_contest() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("ProxyService", 0)], true, None);

    assert_eq!(
        service
            .toggle_autorestart("ProxyService,0")
            .expect("a local service"),
        None
    );
}

#[test]
fn a_coordinate_python_could_not_use_is_named() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], true, Some(5));

    let unknown = service.toggle_autorestart("Nope,0");
    assert!(matches!(unknown, Err(ResourceError::UnknownService(_))));
    assert_eq!(
        unknown.map(|_| ()).unwrap_err().to_string(),
        "Nope,0 is not a local service"
    );

    let malformed = service.toggle_autorestart("LogService");
    assert!(matches!(malformed, Err(ResourceError::Coord(_))));
    assert_eq!(
        malformed.map(|_| ()).unwrap_err().to_string(),
        "service is not spelled name,shard"
    );
}
