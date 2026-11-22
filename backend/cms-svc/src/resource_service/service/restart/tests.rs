//! The guards `_restart_services` exists for, each held by the pass rather than by a comment.

use std::cell::Cell;
use std::rc::Rc;

use crate::resource_service::fixture::{process, service, FixtureReader};
use crate::resource_service::{
    ResourceError, ServiceCommand, ServiceCoord, SpawnError, SpawnedChild, Spawner,
};

/// A spawner that records what it was asked to start and starts nothing.
struct RecordingSpawner {
    commands: Vec<ServiceCommand>,
    alive: Rc<Cell<bool>>,
    is_refusing: bool,
}

impl RecordingSpawner {
    fn new() -> Self {
        Self {
            commands: Vec::new(),
            alive: Rc::new(Cell::new(true)),
            is_refusing: false,
        }
    }

    fn exit_child(&self) {
        self.alive.set(false);
    }
}

impl Spawner for RecordingSpawner {
    fn spawn(&mut self, command: &ServiceCommand) -> Result<Box<dyn SpawnedChild>, SpawnError> {
        self.commands.push(command.clone());
        if self.is_refusing {
            return Err(SpawnError::Failed {
                command: command.clone(),
                source: std::io::Error::from(std::io::ErrorKind::PermissionDenied),
            });
        }
        Ok(Box::new(ScriptedChild {
            alive: Rc::clone(&self.alive),
        }))
    }
}

/// A child whose lifetime the test decides, so a restart is a variable rather than a wait.
struct ScriptedChild {
    alive: Rc<Cell<bool>>,
}

impl SpawnedChild for ScriptedChild {
    fn is_alive(&mut self) -> bool {
        self.alive.get()
    }
}

fn coord(name: &str, shard: i32) -> ServiceCoord {
    ServiceCoord::new(name, shard)
}

#[test]
fn the_services_the_operator_owns_are_never_started() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(
        &reader,
        &[
            ("LogService", 0),
            ("ResourceService", 0),
            ("ProxyService", 0),
            ("Worker", 0),
        ],
        None,
        true,
    );
    let mut spawner = RecordingSpawner::new();
    let report = service
        .restart_services(&mut spawner)
        .expect("a pass over an empty machine");

    assert_eq!(report.spawned, vec![coord("Worker", 0)]);
    assert_eq!(spawner.commands.len(), 1);
    assert_eq!(
        spawner.commands[0].to_string(),
        "/opt/cms/bin/cms-worker 0 -c ALL"
    );
}

#[test]
fn a_proxy_service_is_started_once_a_contest_exists() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(&reader, &[("ProxyService", 0)], Some(7), true);
    let mut spawner = RecordingSpawner::new();

    let report = service
        .restart_services(&mut spawner)
        .expect("a pass over an empty machine");

    assert_eq!(report.spawned, vec![coord("ProxyService", 0)]);
    assert_eq!(
        spawner.commands[0].to_string(),
        "/opt/cms/bin/cms-proxy-service 0 -c 7"
    );
}

#[test]
fn a_service_the_operator_started_by_hand_is_not_started_again() {
    let reader = FixtureReader::with(vec![process(
        4242,
        &["/opt/cms/bin/cms-worker", "0", "-c", "7"],
    )]);
    let mut service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut spawner = RecordingSpawner::new();

    let report = service
        .restart_services(&mut spawner)
        .expect("a pass over a machine with one process");

    assert_eq!(report.spawned, Vec::new());
    assert!(spawner.commands.is_empty());
}

#[test]
fn a_service_that_will_not_restart_is_never_started() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(&reader, &[("Worker", 0)], Some(7), true);
    assert_eq!(
        service.toggle_autorestart("Worker,0").ok(),
        Some(Some(false))
    );
    let mut spawner = RecordingSpawner::new();

    let report = service
        .restart_services(&mut spawner)
        .expect("a pass over an empty machine");

    assert_eq!(report.spawned, Vec::new());
    assert!(spawner.commands.is_empty());
}

#[test]
fn a_service_this_machine_does_not_supervise_is_never_started() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(&reader, &[("Worker", 0)], None, false);
    let mut spawner = RecordingSpawner::new();

    let report = service
        .restart_services(&mut spawner)
        .expect("a pass over an empty machine");

    assert_eq!(report.spawned, Vec::new());
    assert!(spawner.commands.is_empty());
}

#[test]
fn a_live_child_is_not_started_twice() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut spawner = RecordingSpawner::new();
    service
        .restart_services(&mut spawner)
        .expect("the first pass starts the worker");

    let report = service
        .restart_services(&mut spawner)
        .expect("the second pass sees the child it started");

    assert_eq!(report.pruned, 0);
    assert_eq!(report.spawned, Vec::new());
    assert_eq!(spawner.commands.len(), 1);
}

#[test]
fn an_exited_child_is_pruned_and_the_service_is_started_again() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut spawner = RecordingSpawner::new();
    service
        .restart_services(&mut spawner)
        .expect("the first pass starts the worker");
    spawner.exit_child();

    let report = service
        .restart_services(&mut spawner)
        .expect("the second pass restarts the worker");

    assert_eq!(report.pruned, 1);
    assert_eq!(report.spawned, vec![coord("Worker", 0)]);
    assert_eq!(spawner.commands.len(), 2);
}

#[test]
fn services_are_visited_in_the_order_python_visits_them() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(
        &reader,
        &[("Worker", 1), ("Checker", 0), ("Worker", 0)],
        Some(7),
        true,
    );
    let mut spawner = RecordingSpawner::new();

    let report = service
        .restart_services(&mut spawner)
        .expect("a pass over an empty machine");

    assert_eq!(
        report.spawned,
        vec![coord("Checker", 0), coord("Worker", 0), coord("Worker", 1)]
    );
}

#[test]
fn a_spawn_the_os_refuses_is_reported() {
    let reader = FixtureReader::with(Vec::new());
    let mut service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut spawner = RecordingSpawner {
        is_refusing: true,
        ..RecordingSpawner::new()
    };

    let error = service
        .restart_services(&mut spawner)
        .expect_err("a refused spawn is not a quiet pass");

    assert!(matches!(error, ResourceError::Spawn(_)), "{error}");
}
