//! The logger service and the formatter it draws records with, ported from `LogService.py` and `cms/log.py`.

mod civil;
mod formatter;
mod record;

pub use formatter::FormatterSettings;
pub use record::{Record, RecordError};
