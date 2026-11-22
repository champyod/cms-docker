//! System facts, checked against `/proc` itself rather than against fixed numbers.

use std::time::{SystemTime, UNIX_EPOCH};

use cms_svc::{ProcReader, ReadError, ResourceReader};

const MEMINFO: &str = "/proc/meminfo";
const STAT: &str = "/proc/stat";

fn read_proc(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|error| panic!("cannot read {path}: {error}"))
}

fn meminfo_kib(field: &str) -> u64 {
    let text = read_proc(MEMINFO);
    let line = text
        .lines()
        .find(|line| line.starts_with(field))
        .unwrap_or_else(|| panic!("{field} is missing from {MEMINFO}"));
    line.split_whitespace()
        .nth(1)
        .unwrap_or_else(|| panic!("{field} has no value"))
        .parse()
        .unwrap_or_else(|error| panic!("{field} is not a number: {error}"))
}

fn online_cpu_count() -> usize {
    read_proc(STAT)
        .lines()
        .filter(|line| {
            line.strip_prefix("cpu")
                .is_some_and(|rest| rest.starts_with(|first: char| first.is_ascii_digit()))
        })
        .count()
}

#[test]
fn cpu_count_matches_proc_stat() {
    let facts = ProcReader::new().system().unwrap();
    assert_eq!(facts.cpu_count, online_cpu_count());
}

#[test]
fn mem_total_matches_proc_meminfo() {
    let facts = ProcReader::new().system().unwrap();
    assert_eq!(facts.memory.total_bytes, meminfo_kib("MemTotal:") * 1024);
}

fn this_pid() -> i32 {
    i32::try_from(std::process::id()).unwrap()
}

fn real_uid() -> u32 {
    let text = std::fs::read_to_string("/proc/self/status").unwrap();
    let line = text
        .lines()
        .find(|line| line.starts_with("Uid:"))
        .expect("Uid: is missing from /proc/self/status");
    line.split_whitespace()
        .nth(1)
        .expect("Uid: has no value")
        .parse()
        .expect("Uid: is not a number")
}

fn now_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
}

#[test]
fn reads_this_process() {
    let reader = ProcReader::new();
    let facts = reader
        .process(this_pid())
        .expect("this process must be readable");
    assert_eq!(facts.pid, this_pid());

    let executable = std::env::current_exe().unwrap();
    let name = executable.file_name().unwrap().to_str().unwrap();
    let argv0 = facts
        .cmd
        .first()
        .expect("this process has an argument vector");
    assert!(
        argv0.ends_with(name),
        "argv[0] {argv0} does not end with the test binary name {name}"
    );

    assert_eq!(facts.uid, real_uid());
    assert!(facts.resident_bytes > 0, "RSS must be positive");
    assert!(facts.virtual_bytes >= facts.resident_bytes);
    assert!(facts.num_threads >= 1);
    assert!(facts.create_time > 0.0);
    assert!(facts.create_time <= now_seconds());
    assert!(reader.is_running(&facts).unwrap());
}

#[test]
fn process_cpu_time_never_goes_backwards() {
    let reader = ProcReader::new();
    let before = reader.process(this_pid()).unwrap();

    let mut accumulator = 0_u64;
    for index in 0..2_000_000_u64 {
        accumulator = accumulator.wrapping_add(index.wrapping_mul(31));
    }
    std::hint::black_box(accumulator);

    let after = reader.process(this_pid()).unwrap();
    assert!(after.user_cpu_seconds >= before.user_cpu_seconds);
    assert!(after.system_cpu_seconds >= before.system_cpu_seconds);
    assert!(
        after.user_cpu_seconds + after.system_cpu_seconds
            >= before.user_cpu_seconds + before.system_cpu_seconds
    );
}

#[test]
fn a_pid_that_cannot_exist_is_not_found() {
    let error = ProcReader::new()
        .process(i32::MAX)
        .expect_err("no process can hold the largest pid");
    assert!(matches!(error, ReadError::NotFound), "unexpected {error:?}");
}

#[test]
fn a_process_read_then_reaped_is_not_found() {
    let reader = ProcReader::new();
    let mut child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("sleep must start");
    let pid = i32::try_from(child.id()).unwrap();
    let facts = reader.process(pid).expect("a live child must be readable");
    assert_eq!(facts.pid, pid);

    child.kill().unwrap();
    child.wait().unwrap();

    assert!(matches!(reader.process(pid), Err(ReadError::NotFound)));
    assert!(!reader.is_running(&facts).unwrap());
}

#[test]
fn pids_contains_this_process() {
    let pids = ProcReader::new().pids().unwrap();
    assert!(pids.contains(&this_pid()));
}

/// Swap is three views of one number, so the identity holds exactly no matter
/// what the kernel changes between reads. A wrong source field breaks it.
#[test]
fn swap_used_is_total_minus_free() {
    let memory = ProcReader::new().system().unwrap().memory;
    assert_eq!(
        memory.swap_used_bytes + memory.swap_free_bytes,
        memory.swap_total_bytes,
        "swap_used({}) + swap_free({}) must equal swap_total({})",
        memory.swap_used_bytes,
        memory.swap_free_bytes,
        memory.swap_total_bytes
    );
}

/// The fields that move constantly cannot be compared to a second read exactly,
/// so this allows drift — but a wrong source key, or a lost or doubled 1024,
/// misses by far more than the allowance.
#[test]
fn every_memory_field_comes_from_its_own_meminfo_key() {
    let memory = ProcReader::new().system().unwrap().memory;
    let bytes = |key: &str| meminfo_kib(key) * 1024;
    let about = |reported: u64, expected: u64, what: &str| {
        let allowance = expected / 20 + 64 * 1024 * 1024;
        assert!(
            reported.abs_diff(expected) <= allowance,
            "{what}: read {reported} bytes, /proc/meminfo says about {expected}"
        );
    };

    about(memory.total_bytes, bytes("MemTotal:"), "total_bytes");
    about(memory.free_bytes, bytes("MemFree:"), "free_bytes");
    about(
        memory.available_bytes,
        bytes("MemAvailable:"),
        "available_bytes",
    );
    about(memory.buffers_bytes, bytes("Buffers:"), "buffers_bytes");
    // The Rust field is cached plus reclaimable, because that is the pair psutil
    // reports as `cached` on Linux.
    about(
        memory.cached_bytes,
        bytes("Cached:") + bytes("SReclaimable:"),
        "cached_bytes",
    );
    about(
        memory.swap_total_bytes,
        bytes("SwapTotal:"),
        "swap_total_bytes",
    );
    about(
        memory.swap_free_bytes,
        bytes("SwapFree:"),
        "swap_free_bytes",
    );
}
