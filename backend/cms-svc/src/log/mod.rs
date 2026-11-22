//! The logger service and the formatter it draws records with, ported from `LogService.py` and `cms/log.py`.

mod civil;
mod formatter;
mod handlers;
mod recent;
mod record;
mod service;
mod sink;

pub use formatter::FormatterSettings;
pub use record::{Record, RecordError};
pub use service::{LogError, LogService};
