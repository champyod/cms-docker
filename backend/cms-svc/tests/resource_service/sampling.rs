//! One sample against the dict `_store_resources` writes, with deltas the test chooses.

use serde_json::json;

use super::{build, counters, local, process, FakeReader, BIN};

const LOG_SERVICE: &str = "LogService,0";

#[test]
fn a_sample_is_the_dict_python_writes() {
    let reader = FakeReader::new();
    reader.put_process(process(
        42,
        &[&format!("{BIN}/cms-log-service"), "0"],
        5.0,
        2.0,
        3_000_000,
        50.0,
    ));
    let mut service = build(&reader, vec![local("LogService", 0)], true, Some(7));

    service.prime(100.0).expect("the fake reader answers");
    reader.set_cpu(counters(10.5, 0.0, 20.4, 71.1));
    reader.put_process(process(
        42,
        &[&format!("{BIN}/cms-log-service"), "0"],
        5.5,
        2.4,
        3_000_000,
        50.0,
    ));
    let sample = service.sample(102.0).expect("two seconds elapsed");
    let json = sample.to_json();

    let cpu = &json["cpu"];
    assert_eq!(cpu["user"].as_i64(), Some(25));
    assert_eq!(cpu["nice"].as_i64(), Some(0));
    assert_eq!(cpu["system"].as_i64(), Some(20));
    assert_eq!(cpu["idle"].as_i64(), Some(55));
    assert_eq!(cpu["iowait"].as_i64(), Some(0));
    assert_eq!(cpu["irq"].as_i64(), Some(0));
    assert_eq!(cpu["softirq"].as_i64(), Some(0));
    assert_eq!(cpu["num_cpu"].as_u64(), Some(4));

    let memory = &json["memory"];
    assert_eq!(memory["ram_total"].as_f64(), Some(8192.0));
    assert_eq!(memory["ram_available"].as_f64(), Some(2048.0));
    assert_eq!(memory["ram_cached"].as_f64(), Some(1024.0));
    assert_eq!(memory["ram_buffers"].as_f64(), Some(512.0));
    assert_eq!(memory["ram_used"].as_f64(), Some(4608.0));
    assert_eq!(memory["swap_total"].as_f64(), Some(2048.0));
    assert_eq!(memory["swap_available"].as_f64(), Some(1536.0));
    assert_eq!(memory["swap_used"].as_f64(), Some(512.0));

    let entry = &json["services"][LOG_SERVICE];
    assert_eq!(entry["autorestart"], json!(true));
    assert_eq!(entry["running"], json!(true));
    assert_eq!(entry["since"].as_f64(), Some(52.0));
    assert_eq!(entry["resident"].as_u64(), Some(2));
    assert_eq!(entry["virtual"].as_u64(), Some(4));
    assert_eq!(entry["user"].as_i64(), Some(25));
    assert_eq!(entry["sys"].as_i64(), Some(20));
    assert_eq!(entry["threads"].as_i64(), Some(3));
}

#[test]
fn memory_is_a_float_and_process_memory_is_an_integer() {
    let reader = FakeReader::new();
    reader.put_process(process(
        42,
        &[&format!("{BIN}/cms-log-service"), "0"],
        5.0,
        2.0,
        3_000_000,
        50.0,
    ));
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);
    service.prime(100.0).expect("the fake reader answers");
    let json = service
        .sample(102.0)
        .expect("two seconds elapsed")
        .to_json();

    assert!(json["memory"]["ram_total"].is_f64());
    assert_eq!(json["memory"]["ram_total"].as_f64(), Some(8192.0));
    assert!(json["services"][LOG_SERVICE]["resident"].is_u64());
    assert_eq!(json["services"][LOG_SERVICE]["resident"].as_u64(), Some(2));
}

#[test]
fn the_second_sample_measures_from_the_first() {
    let reader = FakeReader::new();
    reader.put_process(process(
        42,
        &[&format!("{BIN}/cms-log-service"), "0"],
        5.0,
        2.0,
        3_000_000,
        50.0,
    ));
    let mut service = build(&reader, vec![local("LogService", 0)], false, None);
    service.prime(100.0).expect("the fake reader answers");
    reader.set_cpu(counters(10.5, 0.0, 20.5, 71.0));
    reader.put_process(process(
        42,
        &[&format!("{BIN}/cms-log-service"), "0"],
        5.5,
        2.5,
        3_000_000,
        50.0,
    ));
    service.sample(102.0).expect("two seconds elapsed");

    reader.set_cpu(counters(11.5, 0.0, 21.0, 73.0));
    reader.put_process(process(
        42,
        &[&format!("{BIN}/cms-log-service"), "0"],
        6.5,
        3.5,
        3_000_000,
        50.0,
    ));
    let json = service
        .sample(106.0)
        .expect("four seconds elapsed")
        .to_json();

    assert_eq!(json["cpu"]["user"].as_i64(), Some(25));
    assert_eq!(json["cpu"]["idle"].as_i64(), Some(50));
    assert_eq!(json["services"][LOG_SERVICE]["user"].as_i64(), Some(25));
    assert_eq!(json["services"][LOG_SERVICE]["since"].as_f64(), Some(56.0));

    let times: Vec<i64> = service
        .get_resources(0.0, 106.0)
        .iter()
        .map(|(time, _)| *time)
        .collect();
    assert_eq!(times, vec![102, 106]);
}

#[test]
fn percentages_round_a_half_to_even_like_python() {
    let reader = FakeReader::new();
    reader.set_cpu(counters(0.0, 0.0, 0.0, 0.0));
    let mut service = build(&reader, vec![], false, None);
    service.prime(0.0).expect("the fake reader answers");

    reader.set_cpu(counters(0.05, 0.0, 0.25, 0.0));
    let sample = service.sample(2.0).expect("two seconds elapsed");

    // 2.5% and 12.5%: half-away-from-zero would report 3 and 13.
    assert_eq!(sample.cpu.user, 2);
    assert_eq!(sample.cpu.system, 12);
}

#[test]
fn two_samples_at_one_instant_are_refused() {
    let reader = FakeReader::new();
    let mut service = build(&reader, vec![], false, None);
    service.prime(100.0).expect("the fake reader answers");

    let refused = service.sample(100.0);

    assert_eq!(
        refused.map(|_| ()).unwrap_err().to_string(),
        "no time elapsed since the previous sample"
    );
}
