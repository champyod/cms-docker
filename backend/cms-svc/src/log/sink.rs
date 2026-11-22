//! The outputs one record reaches: stdout, the open log file, and the ring of warnings.
//!
//! No colour and one rendering for both, where `LogService.py:98-118` sends a shorter, coloured line to stderr.

use std::fs::File;
use std::io::{self, Write};

use serde_json::Value;

use super::formatter::FormatterSettings;
use super::recent::RecentMessages;
use super::record::Record;

/// The levelno `logging.WARNING` sits at, above which a record is remembered.
const WARNING_LEVELNO: i64 = 30;

/// Where one record goes: stdout, the open log file, and the ring of last warnings.
pub(crate) struct Sink {
    file: File,
    writes_stdout: bool,
    recent: RecentMessages,
    settings: FormatterSettings,
}

impl Sink {
    /// Wraps the file a service opened, with the settings its composition root chose.
    #[must_use]
    pub(crate) fn new(file: File, settings: FormatterSettings) -> Self {
        Self {
            file,
            writes_stdout: true,
            recent: RecentMessages::default(),
            settings,
        }
    }

    /// A sink on the file alone, for a unit test: a direct stdout write escapes the harness's capture.
    #[cfg(test)]
    pub(crate) fn file_only(file: File, settings: FormatterSettings) -> Self {
        Self {
            writes_stdout: false,
            ..Self::new(file, settings)
        }
    }

    /// Writes the line to stdout and the file, then remembers a warning or worse.
    ///
    /// # Errors
    ///
    /// The [`io::Error`] of either write; a record that could not be printed is not remembered either.
    pub(crate) fn record(&mut self, record: &Record) -> io::Result<()> {
        let line = record.format(self.settings);
        if self.writes_stdout {
            write_line(&mut io::stdout().lock(), &line)?;
        }
        write_line(&mut self.file, &line)?;
        if record.levelno >= WARNING_LEVELNO {
            self.recent.push(record);
        }
        Ok(())
    }

    /// The remembered warnings, oldest first.
    #[must_use]
    pub(crate) fn last_messages(&self) -> Vec<Value> {
        self.recent.snapshot()
    }
}

/// Writes one line and its terminator, flushed, as `StreamHandler.emit` does.
fn write_line(writer: &mut impl Write, line: &str) -> io::Result<()> {
    writer.write_all(line.as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::path::PathBuf;

    use serde_json::{json, Value};

    use super::Sink;
    use crate::log::formatter::FormatterSettings;
    use crate::log::record::Record;

    /// A sink on a file of its own, named for the test so two runs never meet.
    fn sink_for(test: &str) -> (Sink, PathBuf) {
        let path = std::env::temp_dir().join(format!("cms-log-{test}-{}.log", std::process::id()));
        let file = File::create(&path).expect("the test's own log file must be creatable");
        (Sink::file_only(file, FormatterSettings::UTC), path)
    }

    /// A record with nothing optional set, so a test names only what it is about.
    fn record(data: Value) -> Record {
        Record::from_json(&data).expect("the fixture is a well-formed record")
    }

    fn warning(index: u32) -> Record {
        record(json!({
            "msg": format!("warning {index}"),
            "levelname": "WARNING",
            "levelno": 30,
            "created": 1_700_000_000.125,
        }))
    }

    /// The cap, and the order: 101 warnings leave the last 100 with the first one gone.
    #[test]
    fn a_hundred_and_one_warnings_keep_the_newest_hundred_in_order() {
        let (mut sink, path) = sink_for("ring-cap");
        for index in 0..101 {
            sink.record(&warning(index))
                .expect("the sink writes to a file the test owns");
        }

        let messages = sink.last_messages();
        assert_eq!(messages.len(), 100);
        assert_eq!(messages[0]["message"], json!("warning 1"));
        assert_eq!(messages[99]["message"], json!("warning 100"));
        fs::remove_file(path).expect("the test's own log file is removable");
    }

    /// A record below the warning level is printed but never remembered.
    #[test]
    fn an_info_record_is_written_but_not_remembered() {
        let (mut sink, path) = sink_for("ring-info");
        let info = record(json!({
            "msg": "contest started",
            "levelname": "INFO",
            "levelno": 20,
            "created": 1_700_000_001.5,
        }));

        sink.record(&info)
            .expect("the sink writes to a file the test owns");

        assert!(sink.last_messages().is_empty());
        assert_eq!(
            fs::read_to_string(&path).expect("the test's own log file is readable"),
            "2023-11-14 22:13:21,500 - INFO [<unknown> Main ::None] contest started\n"
        );
        fs::remove_file(path).expect("the test's own log file is removable");
    }

    /// Every key of an entry, with the coordinates kept as the sender wrote them.
    #[test]
    fn an_entry_keeps_the_raw_coordinates_and_the_exception_text() {
        let (mut sink, path) = sink_for("ring-shape");
        let warning = record(json!({
            "msg": "peer is slow",
            "levelname": "WARNING",
            "levelno": 30,
            "created": 1_700_000_002.25,
            "service_name": "WorkerService",
            "service_shard": 3,
            "operation": "collect submissions",
            "exc_text": "KeyError: 'inbox'",
        }));

        sink.record(&warning)
            .expect("the sink writes to a file the test owns");

        assert_eq!(
            sink.last_messages(),
            vec![json!({
                "message": "peer is slow",
                "coord": "WorkerService,3",
                "operation": "collect submissions",
                "severity": "WARNING",
                "timestamp": 1_700_000_002.25,
                "exc_text": "KeyError: 'inbox'",
            })]
        );
        fs::remove_file(path).expect("the test's own log file is removable");
    }

    /// The buffer's coord needs both halves, and an absent exception text is null.
    #[test]
    fn a_lone_service_name_leaves_the_coord_empty() {
        let (mut sink, path) = sink_for("ring-coord");
        let warning = record(json!({
            "msg": "peer is slow",
            "levelname": "WARNING",
            "levelno": 30,
            "created": 1_700_000_003.75,
            "service_name": "ProxyService",
        }));

        sink.record(&warning)
            .expect("the sink writes to a file the test owns");

        let messages = sink.last_messages();
        assert_eq!(messages[0]["coord"], json!(""));
        assert_eq!(messages[0]["operation"], json!(""));
        assert_eq!(messages[0]["exc_text"], Value::Null);
        fs::remove_file(path).expect("the test's own log file is removable");
    }
}
