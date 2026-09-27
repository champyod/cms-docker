//! The `interval` column, in the two forms a driver hands it over.
//!
//! Every shape here is a value an `interval` column actually holds: the sixteen
//! big-endian bytes the binary protocol sends, and the verbose text the text
//! protocol writes back out. The binary layout is checked against the driver's
//! own encoder rather than a copy of it, so agreement with the driver is what is
//! being asserted. Nothing opens a connection.

use chrono::Duration;
use cms_db::{
    Interval, IntervalError, MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_SECOND,
};
use sqlx::encode::Encode;
use sqlx::postgres::types::PgInterval;
use sqlx::postgres::PgArgumentBuffer;

#[test]
fn the_binary_layout_is_the_one_the_driver_writes() {
    // 3_600_000_000 microseconds, then one day, then no month, all big-endian.
    let captured = [
        0x00, 0x00, 0x00, 0x00, 0xd6, 0x93, 0xa4, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x00,
    ];
    let interval = Interval::from_micros(MICROS_PER_DAY + MICROS_PER_HOUR);

    assert_eq!(encoded(&interval), captured);
    assert_eq!(encoded(&interval.to_pg().expect("one day fits")), captured);
}

#[test]
fn a_driver_interval_reduces_to_its_microseconds() {
    let from_driver = Interval::from_pg(PgInterval {
        months: 0,
        days: 1,
        microseconds: 2 * MICROS_PER_HOUR,
    })
    .expect("a day and hours have a fixed length");

    assert_eq!(
        from_driver,
        Interval::from_micros(MICROS_PER_DAY + 2 * MICROS_PER_HOUR)
    );
    assert_eq!(from_driver.whole_seconds(), 93_600);
}

#[test]
fn a_month_is_refused_because_it_has_no_fixed_length() {
    let with_month = PgInterval {
        months: 1,
        days: 0,
        microseconds: 0,
    };

    assert_eq!(
        Interval::from_pg(with_month),
        Err(IntervalError::CalendarField { unit: "mon" })
    );
}

#[test]
fn the_text_layout_reads_back_every_form_the_column_is_written_in() {
    let cases = [
        ("00:00:00", 0),
        ("02:00:00", 2 * MICROS_PER_HOUR),
        ("25 min", 25 * MICROS_PER_MINUTE),
        (
            "3 days 04:05:06",
            3 * MICROS_PER_DAY
                + 4 * MICROS_PER_HOUR
                + 5 * MICROS_PER_MINUTE
                + 6 * MICROS_PER_SECOND,
        ),
        ("2 days", 2 * MICROS_PER_DAY),
        ("@ 1 day 02:00:00", MICROS_PER_DAY + 2 * MICROS_PER_HOUR),
        ("1 12:00:00", MICROS_PER_DAY + 12 * MICROS_PER_HOUR),
        ("00:00:00.500000", 500_000),
        ("-00:00:01", -MICROS_PER_SECOND),
        ("-3 days", -3 * MICROS_PER_DAY),
    ];

    for (text, micros) in cases {
        assert_eq!(
            text.parse::<Interval>().map(Interval::as_micros),
            Ok(micros),
            "{text}"
        );
    }
}

#[test]
fn a_mixed_sign_interval_reads_each_component_on_its_own() {
    // A positive component after a negative one is written with an explicit `+`.
    assert_eq!(
        "-1 days +04:05:06".parse::<Interval>(),
        Ok(Interval::from_micros(
            -MICROS_PER_DAY + 4 * MICROS_PER_HOUR + 5 * MICROS_PER_MINUTE + 6 * MICROS_PER_SECOND
        ))
    );
}

#[test]
fn unreadable_interval_text_is_refused_rather_than_guessed() {
    for text in [
        "",
        "   ",
        "@",
        "5",
        "1 fortnight",
        "1:2:3:4",
        "25:00:00",
        "00:60:00",
        "00:00:60",
        "01.5 days",
    ] {
        assert!(
            text.parse::<Interval>().is_err(),
            "{text} should be refused"
        );
    }
}

#[test]
fn a_year_or_month_in_text_is_named_as_the_reason() {
    assert_eq!(
        "1 mon".parse::<Interval>(),
        Err(IntervalError::CalendarField { unit: "mon" })
    );
    assert_eq!(
        "2 years".parse::<Interval>(),
        Err(IntervalError::CalendarField { unit: "year" })
    );
}

#[test]
fn a_timedelta_crosses_over_unchanged() {
    let original = Duration::seconds(5_400);

    let round_tripped = Interval::from_duration(original)
        .expect("whole seconds cross over")
        .to_duration();

    assert_eq!(round_tripped, original);
}

#[test]
fn a_timedelta_finer_than_a_microsecond_is_refused() {
    let too_fine = Duration::nanoseconds(1_001);

    assert_eq!(
        Interval::from_duration(too_fine),
        Err(IntervalError::SubMicrosecond)
    );
}

#[test]
fn the_two_check_constraints_are_the_predicates_the_columns_use() {
    let zero = Interval::zero();
    let positive = Interval::from_micros(1);

    assert!(zero.is_non_negative() && !zero.is_positive());
    assert!(positive.is_non_negative() && positive.is_positive());
    assert!(!Interval::from_micros(-1).is_non_negative());
}

#[test]
fn ordering_is_total_so_two_durations_never_compare_equal_by_rounding() {
    let mut durations = [
        Interval::from_micros(MICROS_PER_DAY),
        Interval::from_micros(-1),
        Interval::zero(),
        Interval::from_micros(1),
        Interval::from_micros(MICROS_PER_DAY + 1),
    ];
    durations.sort();

    let expected = [-1, 0, 1, MICROS_PER_DAY, MICROS_PER_DAY + 1];
    let sorted: Vec<i64> = durations.iter().map(|i| i.as_micros()).collect();

    assert_eq!(sorted, expected);
}

#[test]
fn seconds_beyond_the_microsecond_range_are_refused() {
    assert_eq!(
        Interval::from_seconds(i64::MAX),
        Err(IntervalError::OutOfRange)
    );
}

fn encoded<T: Encode<'static, sqlx::Postgres>>(value: &T) -> Vec<u8> {
    let mut buffer = PgArgumentBuffer::default();
    let written = value
        .encode(&mut buffer)
        .expect("an in-range value encodes without error");
    assert!(!written.is_null(), "a value is never encoded as null");
    buffer.to_vec()
}
