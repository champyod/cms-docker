//! How a difference is written down, so that a report reads a submission's bytes as
//! a person would read them.
//!
//! Two answers are compared as bytes, but a report is read as text, so every byte a
//! comparison holds is put into text on its way out. These are the two halves of that
//! one step — the length a report is given, and the escape each byte is written as —
//! and they are held apart from the comparison that asks for them because a report's
//! own rules are the same whatever is being compared.
//!
//! Nothing here fails. A byte that cannot be read is not a fault of the worker but a
//! fact about the submission, and it is written as the escape that reads back as that
//! byte rather than dropped or refused.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt::Write as _;

/// How much of a line a report is shown of it, so that a submission which printed a
/// megabyte cannot put a megabyte into an administrator's log.
const LINE_REPORT_LIMIT: usize = 100;

/// Bytes as a report shows them: cut to the length a report is given, and with any
/// byte that is not text written as the escape that reads back as that byte, so
/// nothing is lost and nothing that is not text is shown as though it were.
///
/// The bytes are one line's worth and hold no newline, which is a cut the caller
/// makes: a line was ended before it was asked to be shown, and a newline left
/// among them would end the line the report is written on.
///
/// Bytes too many to show whole are marked as cut rather than passed over silently,
/// so a report says that it is not showing all of them rather than implying that it is.
pub(super) fn report(bytes: &[u8]) -> String {
    let shown = escaped(&bytes[..bytes.len().min(LINE_REPORT_LIMIT)]);
    if bytes.len() > LINE_REPORT_LIMIT {
        shown + "..."
    } else {
        shown
    }
}

/// Bytes as a report shows them, which is [`report`]'s other half: the text among
/// them as it is, and every byte that is not text as its escape.
fn escaped(bytes: &[u8]) -> String {
    let mut shown = String::with_capacity(bytes.len());
    let mut rest = bytes;
    while let Err(broken) = std::str::from_utf8(rest) {
        let (text, unreadable) = rest.split_at(broken.valid_up_to());
        let bad = broken.error_len().unwrap_or(unreadable.len());
        shown.push_str(std::str::from_utf8(text).unwrap_or_default());
        for byte in &unreadable[..bad] {
            write!(shown, "\\x{byte:02x}").expect("writing into a String cannot fail");
        }
        rest = &unreadable[bad..];
    }
    shown.push_str(std::str::from_utf8(rest).unwrap_or_default());
    shown
}
