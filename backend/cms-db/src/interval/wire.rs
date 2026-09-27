//! The wire form of an `interval`.
//!
//! Postgres keeps an interval in three integral fields and sends all three over
//! the binary protocol as sixteen big-endian bytes: eight for the time, four for
//! the day, four for the month. The month is carried rather than folded into the
//! day because a month is not a fixed number of days, which is exactly why
//! [`Interval`] refuses to hold one.
//!
//! The text protocol carries the same value in the verbose form instead, which
//! [`text`](super::text) reads.

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
