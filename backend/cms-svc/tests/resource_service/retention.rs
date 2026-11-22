//! The 660-second window, and the floor `get_resources` applies to its own argument.

use super::{build, local, FakeReader};

#[test]
fn a_sample_older_than_the_window_is_dropped() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);
    service.prime(1000.0).expect("the fake reader answers");
    service.sample(1002.0).expect("two seconds elapsed");
    service.sample(1102.0).expect("a hundred seconds elapsed");
    service
        .sample(1700.0)
        .expect("the window moved past the first sample");

    let times: Vec<i64> = service
        .get_resources(0.0, 1700.0)
        .iter()
        .map(|(time, _)| *time)
        .collect();

    assert_eq!(times, vec![1102, 1700]);
}

#[test]
fn get_resources_never_reaches_past_its_own_window() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);
    service.prime(1000.0).expect("the fake reader answers");
    service.sample(1002.0).expect("two seconds elapsed");
    service.sample(1102.0).expect("a hundred seconds elapsed");

    let times: Vec<i64> = service
        .get_resources(0.0, 1662.5)
        .iter()
        .map(|(time, _)| *time)
        .collect();

    assert_eq!(times, vec![1102]);
}

#[test]
fn get_resources_keeps_only_what_is_strictly_newer() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);
    service.prime(1000.0).expect("the fake reader answers");
    service.sample(1002.0).expect("two seconds elapsed");
    service.sample(1102.0).expect("a hundred seconds elapsed");

    assert!(service.get_resources(1102.0, 1110.0).is_empty());
    let times: Vec<i64> = service
        .get_resources(1002.0, 1110.0)
        .iter()
        .map(|(time, _)| *time)
        .collect();
    assert_eq!(times, vec![1102]);
}

#[test]
fn the_interval_decides_when_a_sample_is_due() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![], false, None);
    service.prime(1000.0).expect("the fake reader answers");

    assert!(!service.is_due(1004.9));
    assert!(service.is_due(1005.0));
    service.sample(1005.0).expect("five seconds elapsed");
    assert!(!service.is_due(1009.9));
    assert!(service.is_due(1010.0));
}
