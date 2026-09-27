//! The fixtures both service suites share: the shard and the one task type the
//! worker under test is configured with, a job that names itself, and a clock
//! handing out one decided reading per call.
//!
//! Nothing is launched and no transport carries anything here either: a job's
//! work is a closure over the job's own body, and a request is charged between
//! two clock readings a test filled in.

// Every suite draws a different part of this file, and the file is a test target
// of its own, so no single compilation uses all of it.
#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::VecDeque;

use cms_proto::Shard;
use cms_worker::service::{Job, Service};
use serde_json::{Map, Value};

/// The shard the worker under test stamps on the jobs it runs.
pub const SHARD: Shard = Shard::new(3);

/// The one task type the worker under test is configured with.
pub const KNOWN: &str = "batch";

/// The key a scripted job body is named under, which is how the work of one job
/// tells itself apart from the work of another.
pub const NAME: &str = "name";

/// A clock a test decided, handing out one reading per call, in order.
pub struct Clock {
    readings: RefCell<VecDeque<f64>>,
}

impl Clock {
    /// A clock that answers with those readings and then refuses, so a test
    /// cannot pass by reading the clock more times than it planned.
    pub fn of(readings: &[f64]) -> Self {
        let queue = RefCell::new(readings.iter().copied().collect());
        Self { readings: queue }
    }

    /// The next reading the test decided.
    pub fn read(&self) -> f64 {
        self.readings
            .borrow_mut()
            .pop_front()
            .expect("one reading per call of the clock")
    }
}

/// A worker of [`SHARD`], configured with the one task type [`KNOWN`].
pub fn worker() -> Service {
    Service::new(SHARD, vec![String::from(KNOWN)])
}

/// A job of that task type, whose body names it so its work can tell it apart
/// from the work of the other jobs of the same group.
pub fn job(name: &str) -> Job {
    let mut body = Map::new();
    body.insert(String::from(NAME), Value::from(name));
    let task_type = String::from(KNOWN);
    Job { task_type, body }
}
