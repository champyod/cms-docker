//! The `interval` integration with the driver, and the only one in the crate.
//!
//! Postgres keeps an interval in three integral fields and sends all three over
//! the binary protocol as sixteen big-endian bytes: eight for the time, four for
//! the day, four for the month. The month is carried rather than folded into the
//! day because a month is not a fixed number of days, which is exactly why
//! [`Interval`] refuses to hold one. The text protocol carries the same value in
//! the verbose form instead, which [`text`](super::text) reads.
//!
//! All three traits a column type needs are declared here, and for [`Interval`]
//! alone: [`Type`] so a query knows the column, [`Encode`] so a value binds, and
//! [`Decode`] so a row comes back. Nothing else in the crate claims a driver
//! trait, because an `interval` is the one column here that is not text — the
//! other families validate what their column holds and hand the caller the
//! string, and the query step that reads those columns is what binds them.
//!
//! # Errors
//!
//! Both directions return the driver's error type. Decoding a binary value that
//! is not the sixteen bytes an `interval` occupies gives
//! [`IntervalError::BinaryLength`], and one carrying a month gives
//! [`IntervalError::CalendarField`], both before any value is built. Encoding
//! gives [`IntervalError::OutOfRange`] when the whole-day part is larger than
//! the `int32` the column's day field holds.

use sqlx::decode::Decode;
use sqlx::encode::{Encode, IsNull};
use sqlx::error::BoxDynError;
use sqlx::postgres::types::PgInterval;
use sqlx::postgres::{PgArgumentBuffer, PgHasArrayType, PgTypeInfo, PgValueFormat, PgValueRef};
use sqlx::types::Type;
use sqlx::Postgres;

use super::text::parse_interval_text;
use super::{Interval, IntervalError, BYTES_PER_PG_INTERVAL};

const MONTHS_OFFSET: usize = 12;
const DAYS_OFFSET: usize = 8;

impl Type<Postgres> for Interval {
    fn type_info() -> PgTypeInfo {
        PgTypeInfo::with_name("INTERVAL")
    }
}

impl PgHasArrayType for Interval {
    fn array_type_info() -> PgTypeInfo {
        PgTypeInfo::array_of("INTERVAL")
    }
}

impl Encode<'_, Postgres> for Interval {
    fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> Result<IsNull, BoxDynError> {
        self.to_pg()?.encode_by_ref(buf)
    }

    fn size_hint(&self) -> usize {
        BYTES_PER_PG_INTERVAL
    }
}

impl<'de> Decode<'de, Postgres> for Interval {
    fn decode(value: PgValueRef<'de>) -> Result<Self, BoxDynError> {
        match value.format() {
            PgValueFormat::Binary => Ok(Self::from_pg(read_pg_interval(value.as_bytes()?)?)?),
            PgValueFormat::Text => Ok(parse_interval_text(value.as_str()?)?),
        }
    }
}

/// Reads the sixteen bytes an `interval` occupies: time, then day, then month.
fn read_pg_interval(bytes: &[u8]) -> Result<PgInterval, IntervalError> {
    if bytes.len() != BYTES_PER_PG_INTERVAL {
        return Err(IntervalError::BinaryLength { found: bytes.len() });
    }
    Ok(PgInterval {
        microseconds: i64::from_be_bytes(field(bytes, 0)),
        days: i32::from_be_bytes(field(bytes, DAYS_OFFSET)),
        months: i32::from_be_bytes(field(bytes, MONTHS_OFFSET)),
    })
}

fn field<const WIDTH: usize>(bytes: &[u8], offset: usize) -> [u8; WIDTH] {
    let mut raw = [0; WIDTH];
    raw.copy_from_slice(&bytes[offset..offset + WIDTH]);
    raw
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::interval::MICROS_PER_HOUR;

    /// One hour, one day and one month in the order the driver sends them.
    const HOUR_DAY_MONTH: [u8; BYTES_PER_PG_INTERVAL] = [
        0x00, 0x00, 0x00, 0x00, 0xd6, 0x93, 0xa4, 0x00, // 3_600_000_000 microseconds
        0x00, 0x00, 0x00, 0x01, // one day
        0x00, 0x00, 0x00, 0x01, // one month
    ];

    #[test]
    fn the_sixteen_bytes_read_back_as_time_then_day_then_month() {
        let read = read_pg_interval(&HOUR_DAY_MONTH).expect("sixteen bytes is the whole layout");

        assert_eq!(
            read,
            PgInterval {
                months: 1,
                days: 1,
                microseconds: MICROS_PER_HOUR,
            }
        );
    }

    #[test]
    fn a_field_of_any_length_but_sixteen_bytes_is_refused() {
        let bytes = [0; BYTES_PER_PG_INTERVAL + 1];

        for found in [0, BYTES_PER_PG_INTERVAL - 1, BYTES_PER_PG_INTERVAL + 1] {
            assert_eq!(
                read_pg_interval(&bytes[..found]),
                Err(IntervalError::BinaryLength { found }),
                "{found} bytes"
            );
        }
    }
}
