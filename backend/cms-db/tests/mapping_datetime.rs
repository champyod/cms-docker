//! `cmscommon.datetime` reproduced, against the numbers the Python module
//! printed.
//!
//! The four fixture rows are the output of `src/cmscommon/datetime.py` run in
//! the `cms-docker-core:major-admin-panel` image (Python 3.12.3, babel 2.12.1)
//! with `src/` mounted at `/opt/src` and prepended to `sys.path`, so they are
//! the original's answer rather than a reading of it.
//!
//! The two zone-sensitive facts are checked in a child process started with
//! `TZ=Asia/Bangkok`: on a UTC host `make_timestamp(Some(..))` and
//! `naive.timestamp()` return the same number, so an in-process assertion
//! would pass under the wrong implementation and prove nothing.

use std::process::Command;

use chrono::{
    DateTime, FixedOffset, Local, NaiveDate, NaiveDateTime, Offset, TimeZone, Timelike, Utc,
};
use cms_db::{make_datetime, make_timestamp, DateTimeError, EPOCH, LOCAL_TZ, UTC};

fn naive(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(year, month, day)
        .expect("a real date")
        .and_hms_opt(hour, minute, second)
        .expect("a real time")
}

fn at_offset(wall: NaiveDateTime, seconds: i32) -> DateTime<FixedOffset> {
    FixedOffset::east_opt(seconds)
        .expect("an offset within a day")
        .from_local_datetime(&wall)
        .single()
        .expect("a fixed offset maps one instant per wall clock")
}

/// Every row of the cross-language table, one assert per row.
#[test]
fn the_four_python_values_come_back_unchanged() {
    let wall = naive(2020, 1, 1, 0, 0, 0);

    // make_timestamp(datetime(2020, 1, 1)) -> 1577836800.0
    assert_eq!(make_timestamp(Some(wall)), 1_577_836_800.0);
    // make_timestamp(datetime(2020, 1, 1, tzinfo=+05:00)) raised TypeError, so
    // the row is the wall clock the original reads: 1577836800.0.
    assert_eq!(make_timestamp(Some(wall)), 1_577_836_800.0);
    assert_eq!(at_offset(wall, 5 * 3600).timestamp(), 1_577_818_800);
    // -08:00 wall clock, same arithmetic, true POSIX 1577865600.0.
    assert_eq!(make_timestamp(Some(wall)), 1_577_836_800.0);
    assert_eq!(at_offset(wall, -8 * 3600).timestamp(), 1_577_865_600);
    // Europe/Rome in DST (UTC+2): make_timestamp -> 1625140800.0,
    // aware .timestamp() -> 1625133600.0.
    let rome = naive(2021, 7, 1, 12, 0, 0);
    assert_eq!(make_timestamp(Some(rome)), 1_625_140_800.0);
    assert_eq!(at_offset(rome, 2 * 3600).timestamp(), 1_625_133_600);
}

/// The offset is not subtracted, and the gap is exactly the offset, which is
/// the whole reason the subtraction cannot be `dt.timestamp()`.
#[test]
fn an_offset_is_not_part_of_the_arithmetic() {
    let wall = naive(2020, 1, 1, 0, 0, 0);
    let read = make_timestamp(Some(wall));

    for offset_seconds in [5 * 3600, -8 * 3600] {
        let aware = at_offset(wall, offset_seconds).timestamp();
        assert_eq!(aware as f64 - read, f64::from(-offset_seconds));
    }

    let rome = naive(2021, 7, 1, 12, 0, 0);
    let aware = at_offset(rome, 2 * 3600).timestamp();
    assert_eq!((aware as f64 - make_timestamp(Some(rome))) as i64, -7_200);
}

/// `make_timestamp` reads a wall clock; `datetime.timestamp()` on a naive
/// datetime reads it in the host's zone. Only a non-UTC host separates them.
#[test]
fn the_answer_does_not_move_with_the_host_zone() {
    let probe = run_probe("probe_local_reading");
    let offset = field(&probe, "local_offset_secs");
    assert_eq!(offset, 25_200, "TZ=Asia/Bangkok was not in force: {probe}");

    assert_eq!(field(&probe, "make_timestamp"), 1_577_836_800);
    // The same wall clock read as Asia/Bangkok: what the wrong port returns.
    assert_eq!(field(&probe, "local_reading"), 1_577_811_600);
    assert_eq!(
        field(&probe, "make_timestamp") - field(&probe, "local_reading"),
        offset
    );
}

/// `make_datetime(None)` is `utcnow()`, so under `TZ=Asia/Bangkok` it must be a
/// whole zone offset away from the local reading, not equal to it.
#[test]
fn the_default_is_now_in_utc_not_in_local_time() {
    let probe = run_probe("probe_utc_now");
    let offset = field(&probe, "local_offset_secs");
    assert_eq!(offset, 25_200, "TZ=Asia/Bangkok was not in force: {probe}");

    let from_utc = field(&probe, "made_minus_utc_secs");
    let from_local = field(&probe, "made_minus_local_secs");
    assert!(from_utc.abs() <= 2, "not the current instant: {probe}");
    assert!(
        (from_local + offset).abs() <= 2,
        "default is local time rather than UTC: {probe}"
    );
}

/// The timestamp column's own rows: what `utcfromtimestamp` accepted and what
/// it refused, with the same year range.
#[test]
fn a_timestamp_becomes_a_utc_datetime_or_is_refused() {
    let cases = [
        (
            1_577_836_800.123_456,
            naive(2020, 1, 1, 0, 0, 0).with_nanosecond(123_456_000),
        ),
        (
            -1.5,
            naive(1969, 12, 31, 23, 59, 58).with_nanosecond(500_000_000),
        ),
        (-62_135_596_800.0, Some(naive(1, 1, 1, 0, 0, 0))),
    ];
    for (timestamp, expected) in cases {
        assert_eq!(
            make_datetime(Some(timestamp)),
            Ok(expected.expect("a datetime"))
        );
    }

    for (timestamp, expected) in [
        (f64::NAN, Err(DateTimeError::NotFinite)),
        (f64::INFINITY, Err(DateTimeError::NotFinite)),
        (1e20, Err(DateTimeError::OutOfRange)),
        // year 10000 and year 0, the two ends `datetime` refuses.
        (253_402_300_800.0, Err(DateTimeError::OutOfRange)),
        (-62_135_596_801.0, Err(DateTimeError::OutOfRange)),
    ] {
        assert_eq!(make_datetime(Some(timestamp)), expected);
    }
}

/// Fractional seconds round to the microsecond, ties to even, as
/// `utcfromtimestamp` does.
#[test]
fn a_fractional_second_rounds_to_even_microseconds() {
    let micros = [
        (0.000_000_5, 0),
        (0.000_001_5, 2),
        (0.000_002_5, 2),
        (-0.000_000_5, 0),
        (1.999_999_5, 1_999_999),
    ];
    for (timestamp, expected) in micros {
        let made = make_datetime(Some(timestamp)).expect("inside the year range");
        assert_eq!(
            made.and_utc().timestamp_micros(),
            expected,
            "{timestamp} should be {expected} µs"
        );
    }
}

/// The two zones and the epoch the Python module names.
#[test]
fn the_named_values_are_the_pythons() {
    assert_eq!(
        EPOCH,
        NaiveDate::from_ymd_opt(1970, 1, 1)
            .expect("the epoch is a real date")
            .and_hms_opt(0, 0, 0)
            .expect("midnight")
    );
    assert_eq!(EPOCH.and_utc().timestamp(), 0);
    assert_eq!(
        UTC.offset_from_utc_datetime(&EPOCH).fix().local_minus_utc(),
        0
    );
    // A zone, not a name: `LOCAL_TZ` is whatever the host reports, which is the
    // point of it being a type rather than a string.
    let local = LOCAL_TZ
        .offset_from_utc_datetime(&EPOCH)
        .fix()
        .local_minus_utc();
    assert!((-12 * 3600..=14 * 3600).contains(&local));
}

/// Runs one `#[ignore]`d probe in a fresh process with a non-UTC zone.
fn run_probe(test: &str) -> String {
    let exe = std::env::current_exe().expect("the test binary has a path");
    let output = Command::new(exe)
        .args(["--exact", test, "--ignored", "--nocapture"])
        .env("TZ", "Asia/Bangkok")
        .output()
        .expect("the probe process starts");
    assert!(
        output.status.success(),
        "probe {test} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("the probe wrote UTF-8")
}

/// One `key=value` line of a probe's output.
fn field(output: &str, key: &str) -> i64 {
    output
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")))
        .unwrap_or_else(|| panic!("probe printed no `{key}`: {output}"))
        .trim()
        .parse()
        .expect("the probe prints an integer")
}

#[test]
#[ignore = "child of the_answer_does_not_move_with_the_host_zone; needs TZ=Asia/Bangkok"]
fn probe_local_reading() {
    let wall = naive(2020, 1, 1, 0, 0, 0);
    println!(
        "local_offset_secs={}",
        Local::now().offset().local_minus_utc()
    );
    println!("make_timestamp={}", make_timestamp(Some(wall)) as i64);
    println!(
        "local_reading={}",
        LOCAL_TZ
            .from_local_datetime(&wall)
            .single()
            .expect("Bangkok has no transition at midnight")
            .timestamp()
    );
}

#[test]
#[ignore = "child of the_default_is_now_in_utc_not_in_local_time; needs TZ=Asia/Bangkok"]
fn probe_utc_now() {
    let made = make_datetime(None).expect("the clock is representable");
    println!(
        "local_offset_secs={}",
        Local::now().offset().local_minus_utc()
    );
    println!(
        "made_minus_utc_secs={}",
        (made - Utc::now().naive_utc()).num_seconds()
    );
    println!(
        "made_minus_local_secs={}",
        (made - Local::now().naive_local()).num_seconds()
    );
}
