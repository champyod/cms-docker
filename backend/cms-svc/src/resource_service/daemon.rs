//! The thread that owns the resource service: its sampling timer, its restart pass, its answers.

use std::sync::mpsc::{Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::error::ResourceError;
use super::handlers::Request;
use super::service::ResourceService;
use super::spawn::Spawner;
use super::ServiceCoord;
use crate::Stop;

/// How long the loop waits between a mailbox read, a clock read and a stop check.
const IDLE: Duration = Duration::from_millis(50);

/// What one timer pass did, so the caller can report it without re-deriving it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Tick {
    /// Whether a sample was taken and stored.
    pub sampled: bool,
    /// Services the restart pass started, in the order it started them.
    pub spawned: Vec<ServiceCoord>,
}

/// One timer pass: the restart pass when supervision is on, then the sample the interval asks for.
///
/// # Errors
///
/// [`ResourceError`] from the restart pass or the sample; the caller reports it and keeps timing.
pub fn tick(
    service: &mut ResourceService<'_>,
    spawner: &mut dyn Spawner,
    now: f64,
) -> Result<Tick, ResourceError> {
    let mut pass = Tick::default();
    if !service.is_due(now) {
        return Ok(pass);
    }
    // WHY before the sample: a sample that fails must not also cost the restart pass Python would have run.
    if service.is_autorestarting() {
        pass.spawned = service.restart_services(spawner)?.spawned;
    }
    service.sample(now)?;
    pass.sampled = true;
    Ok(pass)
}

/// Answers the wire and takes samples until `stop` is requested.
///
/// The host waits for the answers already underway before it returns, so a request still queued
/// when this loop ends is answered by dropping the receiver: `recv` on the wire thread then fails
/// and that caller is told the service is stopping instead of waiting forever.
pub fn serve(
    service: &mut ResourceService<'_>,
    spawner: &mut dyn Spawner,
    stop: &Stop,
    mailbox: &Receiver<Request>,
) {
    // WHY: Python adds the restart timeout with immediately=True, so the first pass runs at startup.
    if service.is_autorestarting() {
        report_restart(service.restart_services(spawner));
    }
    while !stop.is_requested() {
        drain(mailbox, service);
        let now = now_seconds();
        if service.is_due(now) {
            match tick(service, spawner, now) {
                Ok(pass) => report_tick(&pass),
                Err(error) => eprintln!("cms-resource-service: the sampling pass failed: {error}"),
            }
        }
        thread::sleep(IDLE);
    }
}

/// Answers every question waiting in the mailbox, on the thread that owns the service.
fn drain(mailbox: &Receiver<Request>, service: &mut ResourceService<'_>) {
    let now = now_seconds();
    loop {
        match mailbox.try_recv() {
            Ok(request) => {
                if let Err(error) = request.answer(service, now) {
                    eprintln!("cms-resource-service: {error}");
                }
            }
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => return,
        }
    }
}

fn report_restart(result: Result<super::RestartReport, ResourceError>) {
    match result {
        Ok(report) => {
            for coord in &report.spawned {
                eprintln!("cms-resource-service: restarted {coord}");
            }
        }
        Err(error) => eprintln!("cms-resource-service: the restart pass failed: {error}"),
    }
}

fn report_tick(pass: &Tick) {
    for coord in &pass.spawned {
        eprintln!("cms-resource-service: restarted {coord}");
    }
}

/// The seconds since the epoch with the subsecond part, which is what Python's `time.time()` is.
fn now_seconds() -> f64 {
    // WHY: a clock before 1970 has no gap to measure, and a silent zero would sample one instant twice.
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock reads after the epoch")
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use super::{tick, Tick};
    use crate::resource_service::fixture::{service, FixtureReader};
    use crate::resource_service::{
        ResourceService, ServiceCommand, ServiceCoord, SpawnError, SpawnedChild, Spawner,
    };

    const BIN: &str = "/opt/cms/bin";

    /// A spawner that records what it was asked to start and starts nothing.
    #[derive(Default)]
    struct RecordingSpawner {
        commands: Vec<ServiceCommand>,
    }

    impl Spawner for RecordingSpawner {
        fn spawn(&mut self, command: &ServiceCommand) -> Result<Box<dyn SpawnedChild>, SpawnError> {
            self.commands.push(command.clone());
            Ok(Box::new(Endless))
        }
    }

    /// A child that never exits, so a pass cannot start the same service twice.
    struct Endless;

    impl SpawnedChild for Endless {
        fn is_alive(&mut self) -> bool {
            true
        }
    }

    fn built<'a>(reader: &'a FixtureReader, autorestart: bool) -> ResourceService<'a> {
        service(reader, &[("Worker", 0)], None, autorestart)
    }

    #[test]
    fn a_sample_is_taken_only_when_the_interval_is_due() {
        let reader = FixtureReader::with(Vec::new());
        let mut service = built(&reader, false);
        service.prime(0.0).expect("an empty machine primes");
        let mut spawner = RecordingSpawner::default();

        let pass = tick(&mut service, &mut spawner, 1.0).expect("nothing to read is not an error");
        assert_eq!(
            pass,
            Tick::default(),
            "an instant inside the interval must not sample"
        );
        assert!(service.get_resources(0.0, 1.0).is_empty());

        let pass = tick(&mut service, &mut spawner, 5.0).expect("the interval elapsed");
        assert!(pass.sampled);
        assert_eq!(service.get_resources(0.0, 5.0).len(), 1);
    }

    #[test]
    fn the_restart_pass_starts_a_stopped_service_when_supervision_is_on() {
        let reader = FixtureReader::with(Vec::new());
        let mut service = built(&reader, true);
        service.prime(0.0).expect("an empty machine primes");
        let mut spawner = RecordingSpawner::default();

        let pass = tick(&mut service, &mut spawner, 5.0).expect("the interval elapsed");

        assert_eq!(pass.spawned, [ServiceCoord::new("Worker", 0)]);
        assert_eq!(
            spawner.commands,
            [
                ServiceCommand::of(&ServiceCoord::new("Worker", 0), Path::new(BIN), None)
                    .expect("Worker has a binary name")
            ]
        );
    }

    #[test]
    fn nothing_is_started_when_supervision_is_off() {
        let reader = FixtureReader::with(Vec::new());
        let mut service = built(&reader, false);
        service.prime(0.0).expect("an empty machine primes");
        let mut spawner = RecordingSpawner::default();

        let pass = tick(&mut service, &mut spawner, 5.0).expect("the interval elapsed");

        assert!(pass.spawned.is_empty());
        assert!(spawner.commands.is_empty());
    }

    #[test]
    fn the_interval_the_service_reports_is_the_gap_a_sample_waits_for() {
        let reader = FixtureReader::with(Vec::new());
        let service = built(&reader, false);
        assert_eq!(service.interval(), Duration::from_secs(5));
    }
}
