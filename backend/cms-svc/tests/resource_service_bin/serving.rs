//! What the running binary answers: a real sample, the base methods, and only this machine's services.

use std::collections::BTreeSet;
use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::{call, connect, finish, started};

/// How long a sample is waited for: the service's interval is 5s, and the pass may lag it a little.
const SAMPLE_DEADLINE: Duration = Duration::from_secs(15);

/// How often the empty answer is asked again while the first interval runs out.
const SAMPLE_POLL: Duration = Duration::from_millis(200);

/// The machine figures `get_resources` reports, as `ResourceService.py` spells them.
const CPU_FIGURES: [&str; 8] = [
    "user", "nice", "system", "idle", "iowait", "irq", "softirq", "num_cpu",
];

/// The memory figures, the eight `ram_*` and `swap_*` keys.
const MEMORY_FIGURES: [&str; 8] = [
    "ram_total",
    "ram_available",
    "ram_cached",
    "ram_buffers",
    "ram_used",
    "swap_total",
    "swap_available",
    "swap_used",
];

/// Asks for the samples until the first interval has produced one.
fn first_sample(stream: &mut TcpStream) -> Value {
    let started = Instant::now();
    while started.elapsed() < SAMPLE_DEADLINE {
        let answer = call(stream, "1", "get_resources", json!({"last_time": 0.0}));
        if let Some(samples) = answer["__data"].as_array() {
            if let Some(sample) = samples.first() {
                return sample.clone();
            }
        }
        thread::sleep(SAMPLE_POLL);
    }
    panic!("no sample arrived within {SAMPLE_DEADLINE:?}");
}

#[test]
fn a_sample_names_only_this_machines_services_and_has_the_sampled_shape() {
    let (_running, addr) = started();
    let mut stream = connect(addr);
    let sample = first_sample(&mut stream);

    let (time, data) = sample
        .as_array()
        .and_then(|pair| Some((pair.first()?.as_i64()?, pair.get(1)?)))
        .expect("a sample travels as a (time, data) pair");
    assert!(time > 0, "the sample time is the epoch second it was taken");

    for figure in CPU_FIGURES {
        assert!(
            data["cpu"][figure].is_number(),
            "cpu lacks {figure}: {data}"
        );
    }
    for figure in MEMORY_FIGURES {
        assert!(
            data["memory"][figure].is_number(),
            "memory lacks {figure}: {data}"
        );
    }

    let services = data["services"]
        .as_object()
        .expect("the sample keys its services by coordinate");
    let seen: BTreeSet<&str> = services.keys().map(String::as_str).collect();
    assert_eq!(
        seen,
        BTreeSet::from(["LogService,0", "ResourceService,0", "Worker,0"]),
        "another host's Worker,1 must never be reported"
    );
    for (coord, usage) in services {
        assert_eq!(
            usage["autorestart"],
            Value::Null,
            "supervision is off unless a contest or the flag turns it on"
        );
        assert!(
            usage["running"].is_boolean(),
            "{coord} must say whether it runs, got: {usage}"
        );
    }
    assert_eq!(
        services["Worker,0"]["running"],
        json!(false),
        "nothing on this machine runs the worker binary"
    );
}

#[test]
fn the_base_methods_are_served_alongside_the_two_this_service_adds() {
    let (_running, addr) = started();
    let mut stream = connect(addr);

    assert_eq!(
        call(&mut stream, "1", "echo", json!({"string": "héllo"}))["__data"],
        json!("héllo"),
        "the base echo is composed onto this service's table"
    );
    assert_eq!(
        call(
            &mut stream,
            "2",
            "toggle_autorestart",
            json!({"service": "Worker,0"})
        )["__data"],
        Value::Null,
        "with supervision off, Python answers None rather than flipping a flag"
    );
}

#[test]
fn quit_stops_the_process_and_it_exits_zero() {
    let (running, addr) = started();
    let mut stream = connect(addr);

    assert_eq!(
        call(&mut stream, "1", "quit", json!({"reason": "asked to stop"}))["__data"],
        Value::Null
    );

    let (status, stderr) = finish(running);
    assert!(status.success(), "a plain quit exits zero, got {status:?}");
    assert!(
        stderr.contains("Trying to exit as asked by another service (asked to stop)."),
        "the reason must be the one it was given, got: {stderr}"
    );
}
