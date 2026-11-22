//! System facts, checked against `/proc` itself rather than against fixed numbers.

use cms_svc::{ProcReader, ResourceReader};

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
