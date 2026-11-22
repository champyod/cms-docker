//! The matcher over a pid list, so both command-line forms are seen in one machine.

use std::path::Path;

use cms_svc::{ProcessMatcher, ServiceCoord};

use super::{local, process, FakeReader, BIN};

fn python_service(pid: i32, script: &str, shard: &str) -> cms_svc::ProcessFacts {
    process(
        pid,
        &["/usr/local/bin/python3", script, shard],
        0.0,
        0.0,
        0,
        0.0,
    )
}

fn binary_service(pid: i32, binary: &str, shard: &str) -> cms_svc::ProcessFacts {
    process(pid, &[binary, shard], 0.0, 0.0, 0, 0.0)
}

#[test]
fn both_command_line_forms_are_found_on_one_machine() {
    let reader = FakeReader::new();
    reader.put_process(python_service(10, "/opt/cms/bin/cmsLogService", "0"));
    reader.put_process(binary_service(11, "/opt/cms/bin/cms-log-service", "1"));

    let matcher = ProcessMatcher::scan(&reader, Path::new(BIN)).expect("the fake reader answers");
    let services = vec![local("LogService", 0), local("LogService", 1)];

    assert_eq!(
        matcher
            .find(&ServiceCoord::new("LogService", 0), &services)
            .map(|facts| facts.pid),
        Some(10)
    );
    assert_eq!(
        matcher
            .find(&ServiceCoord::new("LogService", 1), &services)
            .map(|facts| facts.pid),
        Some(11)
    );
}

#[test]
fn a_command_line_outside_the_bin_directory_is_not_a_service() {
    let reader = FakeReader::new();
    reader.put_process(python_service(10, "/home/user/cmsLogService", "0"));
    reader.put_process(binary_service(11, "/home/user/cms-log-service", "0"));

    let matcher = ProcessMatcher::scan(&reader, Path::new(BIN)).expect("the fake reader answers");

    assert_eq!(
        matcher.find(
            &ServiceCoord::new("LogService", 0),
            &[local("LogService", 0)]
        ),
        None
    );
}

#[test]
fn an_unstated_shard_resolves_only_when_one_local_shard_has_the_name() {
    let reader = FakeReader::new();
    reader.put_process(process(11, &["/opt/cms/bin/cms-worker"], 0.0, 0.0, 0, 0.0));

    let matcher = ProcessMatcher::scan(&reader, Path::new(BIN)).expect("the fake reader answers");
    let one_worker = vec![local("Worker", 1)];

    assert_eq!(
        matcher
            .find(&ServiceCoord::new("Worker", 1), &one_worker)
            .map(|facts| facts.pid),
        Some(11)
    );
    let two_workers = vec![local("Worker", 1), local("Worker", 2)];
    assert_eq!(
        matcher.find(&ServiceCoord::new("Worker", 2), &two_workers),
        None
    );
}
