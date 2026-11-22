//! The line `DetailedFormatter` draws for one record (`cms/log.py:203-226`, `241-264`).
//!
//! No colour: the file formatter is `DetailedFormatter(False)` and a container's stdout is a pipe.

use super::civil;
use super::record::Record;

/// What the coordinates read when the record carries no service pair.
const UNKNOWN_COORDINATES: &str = "<unknown>";

/// How Python prints a function name that was never set.
const ABSENT_FUNCTION_NAME: &str = "None";

/// Milliseconds in a second, the unit the fraction of `created` is scaled by.
const MILLIS_PER_SECOND: f64 = 1_000.0;

/// The settings the composition root decides before the formatter draws anything.
///
/// The printed clock is `time.localtime` in Python; `std` has no zone database, so the offset is supplied instead of guessed at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FormatterSettings {
    /// Seconds the printed clock is ahead of UTC.
    pub utc_offset_seconds: i64,
}

impl FormatterSettings {
    /// UTC, the zone the service's own container reports and the parity fixtures pin.
    pub const UTC: Self = Self {
        utc_offset_seconds: 0,
    };
}

impl Record {
    /// The line `DetailedFormatter` draws, without the newline a handler appends.
    #[must_use]
    pub fn format(&self, settings: FormatterSettings) -> String {
        let mut line = format!("{} - {}", self.timestamp(settings), self.levelname);
        let coordinates = self.coordinates();
        if !coordinates.trim().is_empty() {
            line.push_str(&format!(" [{}]", coordinates.trim()));
        }
        if let Some(operation) = self.operation_text() {
            line.push_str(&format!(" [{operation}]"));
        }
        line.push(' ');
        line.push_str(&self.msg);
        if let Some(exc_text) = self.exc_text.as_deref().filter(|text| !text.is_empty()) {
            if !line.ends_with('\n') {
                line.push('\n');
            }
            line.push_str(exc_text);
        }
        line
    }

    /// The operation, once blanked out, since Python prints the bracket only for a non-blank one.
    fn operation_text(&self) -> Option<&str> {
        self.operation
            .as_deref()
            .map(str::trim)
            .filter(|operation| !operation.is_empty())
    }

    /// `formatTime`: the wall clock, then the milliseconds the record carries.
    fn timestamp(&self, settings: FormatterSettings) -> String {
        let whole = self.created.floor();
        let clock = civil::at(whole as i64 + settings.utc_offset_seconds);
        let millis = self
            .msecs
            .unwrap_or((self.created - whole) * MILLIS_PER_SECOND) as i64;
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02},{:03}",
            clock.year, clock.month, clock.day, clock.hour, clock.minute, clock.second, millis
        )
    }

    /// The service pair, thread, file and function, as `DetailedFormatter` joins them.
    fn coordinates(&self) -> String {
        let mut coordinates = match (&self.service_name, self.service_shard) {
            (Some(name), Some(shard)) => format!("{},{}", shortened_service(name), shard),
            _ => UNKNOWN_COORDINATES.to_owned(),
        };
        coordinates.push(' ');
        coordinates.push_str(&self.thread_name.replace("Thread", "").replace("Dummy-", ""));
        coordinates.push_str(&format!(
            " {}::{}",
            self.filename.replace(".py", ""),
            self.func_name.as_deref().unwrap_or(ABSENT_FUNCTION_NAME)
        ));
        coordinates
    }
}

/// The service name with its class suffix dropped, in the order `cms/log.py:280-281` drops it.
fn shortened_service(name: &str) -> String {
    name.replace("Service", "").replace("WebServer", "")
}
