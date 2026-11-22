//! Epoch seconds to the wall clock `time.localtime` would print, at an offset the caller fixes.

/// Seconds in a day, the unit the calendar is entered from.
const SECONDS_PER_DAY: i64 = 86_400;

/// Seconds in an hour, a minute and the day they divide.
const SECONDS_PER_HOUR: i64 = 3_600;
const SECONDS_PER_MINUTE: i64 = 60;

/// One instant, broken into the fields `%Y-%m-%d %H:%M:%S` prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallClock {
    /// Years since the epoch, signed because the calendar reaches before it.
    pub year: i64,
    /// Month of the year, 1 to 12.
    pub month: u32,
    /// Day of the month, 1 to 31.
    pub day: u32,
    /// Hour of the day, 0 to 23.
    pub hour: u32,
    /// Minute of the hour, 0 to 59.
    pub minute: u32,
    /// Second of the minute, 0 to 59.
    pub second: u32,
}

/// The wall clock `seconds` after the epoch, already shifted by the caller's offset.
#[must_use]
pub fn at(seconds: i64) -> WallClock {
    let days = seconds.div_euclid(SECONDS_PER_DAY);
    let second_of_day = seconds.rem_euclid(SECONDS_PER_DAY);
    let (year, month, day) = date_of(days);
    WallClock {
        year,
        month,
        day,
        hour: (second_of_day / SECONDS_PER_HOUR) as u32,
        minute: (second_of_day % SECONDS_PER_HOUR / SECONDS_PER_MINUTE) as u32,
        second: (second_of_day % SECONDS_PER_MINUTE) as u32,
    }
}

/// The civil date `days` days after 1970-01-01, Howard Hinnant's `civil_from_days`.
fn date_of(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era + era * 400 + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{at, date_of, WallClock};

    /// The epoch itself, which is the calendar's anchor.
    #[test]
    fn the_epoch_is_the_first_of_january_1970() {
        assert_eq!(
            at(0),
            WallClock {
                year: 1970,
                month: 1,
                day: 1,
                hour: 0,
                minute: 0,
                second: 0
            }
        );
    }

    /// A leap day, which a year length that ignores February would land a day early.
    #[test]
    fn a_leap_day_keeps_its_date() {
        assert_eq!(date_of(18_321), (2020, 2, 29));
    }

    /// Before the epoch, where truncating division would fold a day into the wrong date.
    #[test]
    fn the_day_before_the_epoch_stays_in_december() {
        assert_eq!(date_of(-1), (1969, 12, 31));
    }

    /// The instant the formatter's fixtures pin, checked off the calendar rather than the formatter.
    #[test]
    fn a_known_instant_lands_on_its_printed_clock() {
        assert_eq!(
            at(1_700_000_000),
            WallClock {
                year: 2023,
                month: 11,
                day: 14,
                hour: 22,
                minute: 13,
                second: 20
            }
        );
    }
}
