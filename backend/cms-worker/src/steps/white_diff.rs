//! An answer compared with the one a dataset says is right, in the two ways a task
//! can ask for.
//!
//! [`exact_diff`] is a byte comparison: the two answers are the same file or they are
//! not, and the first byte that differs ends the comparison. [`white_diff`] is the
//! reference's diff, which forgives whitespace and nothing else: two answers are the
//! same when line for line they agree once each line's leading and trailing
//! whitespace is gone and every run of whitespace inside it is one space, so where a
//! line breaks and what it holds are both part of the answer. A run of whitespace at
//! the very end of either side is not an answer, so an answer that stopped short or ran
//! on is only wrong when what it has beyond the other side is not whitespace.
//!
//! Both report the same way: nothing at all when the answers are the same, and the
//! first difference otherwise, which is what a report is written from. What a
//! difference is worth is [`Comparison`]'s answer, which is the whole score or none of
//! it — a comparison has no middle, and no reason to hold one.
//!
//! # Errors
//!
//! None, and that is the point of both functions: a difference between two answers is
//! a statement about a submission rather than a fault in the worker, so it is
//! [`Difference`] and a value. A file that could not be read is a fault, and it is
//! reported by the caller that read it, before either of these is asked.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::fmt::Write as _;

use super::StockMessage;

/// What an answer is worth when it is right, and what it is worth when it is not.
const FULL_CREDIT: f64 = 1.0;
const NO_CREDIT: f64 = 0.0;

/// The byte that ends a line, and the only one a comparison counts.
const NEWLINE: u8 = b'\n';
/// The whites a diff forgives: the ASCII members of Unicode's White_Space property,
/// which is the set the reference takes, and not one more.
const WHITES: [u8; 6] = [b' ', b'\t', b'\n', 0x0b, 0x0c, b'\r'];
/// How much of a line a report is shown of it, so that a submission which printed a
/// megabyte cannot put a megabyte into an administrator's log.
const LINE_REPORT_LIMIT: usize = 100;

/// Why two answers are not the same, which is the first thing that is not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Difference {
    /// The submission printed what the correct answer has no more of.
    TooLong,
    /// The submission stopped before what the correct answer still holds.
    TooShort,
    /// A line says something other than what the correct answer's line says.
    Line {
        /// The line the two answers first differ on, counted from one.
        number: usize,
        /// What the correct answer says there, as a report shows it.
        expected: String,
        /// What the submission said there, as a report shows it.
        found: String,
    },
}

impl fmt::Display for Difference {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLong => write!(f, "Contestant output too long"),
            Self::TooShort => write!(f, "Contestant output too short"),
            Self::Line {
                number,
                expected,
                found,
            } => write!(f, "Expected `{expected}`, found `{found}` on line {number}"),
        }
    }
}

impl std::error::Error for Difference {}

/// Compares two answers byte for byte, stopping at the first byte that differs.
///
/// The line the difference falls on is read from both answers so that the difference
/// can be reported as one, which costs one line of reading after the difference and
/// nothing before it: the bytes up to it are walked once, counting the newlines they
/// hold, and that walk is the walk that finds the difference.
pub fn exact_diff(output: &[u8], correct: &[u8]) -> Result<(), Difference> {
    let common = common_prefix(output, correct);
    if common == output.len() && common == correct.len() {
        return Ok(());
    }
    let number = 1 + output[..common]
        .iter()
        .filter(|byte| **byte == NEWLINE)
        .count();
    Err(Difference::Line {
        number,
        expected: line_at(correct, number),
        found: line_at(output, number),
    })
}

/// How many bytes the two answers hold alike from their first, which is the whole of
/// the shorter one where neither is longer than the other.
fn common_prefix(output: &[u8], correct: &[u8]) -> usize {
    let end = output.len().min(correct.len());
    output[..end]
        .iter()
        .zip(&correct[..end])
        .position(|(answer, expected)| answer != expected)
        .unwrap_or(end)
}

/// Compares two answers line for line, forgiving whitespace and nothing else.
pub fn white_diff(output: &[u8], correct: &[u8]) -> Result<(), Difference> {
    let mut found = output.split_inclusive(|byte| *byte == NEWLINE);
    let mut expected = correct.split_inclusive(|byte| *byte == NEWLINE);
    let mut number = 0;
    loop {
        number += 1;
        match (found.next(), expected.next()) {
            (None, None) => return Ok(()),
            (Some(answer), None) if !blank(answer) => return Err(Difference::TooLong),
            (None, Some(answer)) if !blank(answer) => return Err(Difference::TooShort),
            (Some(found), Some(expected)) if canonicalize(found) != canonicalize(expected) => {
                return Err(Difference::Line {
                    number,
                    expected: report(expected),
                    found: report(found),
                })
            }
            _ => {}
        }
    }
}

/// A line in the one form a diff compares: no whitespace at either end, and one space
/// wherever a run of it stood.
///
/// The space is held back until a byte that is not whitespace shows it, so a run at
/// either end of the line has nothing to show it and is dropped rather than folded.
fn canonicalize(line: &[u8]) -> Vec<u8> {
    let mut folded: Vec<u8> = Vec::with_capacity(line.len());
    let mut gap = false;
    for byte in line.iter().copied() {
        if WHITES.contains(&byte) {
            gap = !folded.is_empty();
            continue;
        }
        if gap {
            folded.push(b' ');
        }
        gap = false;
        folded.push(byte);
    }
    folded
}

/// Whether a line is nothing but whitespace, and so is not an answer at all.
fn blank(line: &[u8]) -> bool {
    line.iter().all(|byte| WHITES.contains(byte))
}

/// A line as a report shows it: cut at the line's own end, cut again to the length a
/// report is given, and with any byte that is not text written as its escape.
///
/// A line too long to show whole is marked as cut rather than passed over silently,
/// so a report says that it is not showing all of it rather than implying that it is.
fn report(line: &[u8]) -> String {
    let whole = match line.iter().position(|byte| *byte == NEWLINE) {
        Some(end) => &line[..end],
        None => line,
    };
    let cut = &whole[..whole.len().min(LINE_REPORT_LIMIT)];
    let shown = escaped(cut);
    if whole.len() > LINE_REPORT_LIMIT {
        shown + "..."
    } else {
        shown
    }
}

/// The `number`th line of an answer, as a report shows it, and empty where the answer
/// has no line of that number.
fn line_at(answer: &[u8], number: usize) -> String {
    let mut rest = answer;
    for _ in 1..number {
        let Some(end) = rest.iter().position(|byte| *byte == NEWLINE) else {
            return String::new();
        };
        rest = &rest[end + 1..];
    }
    report(rest)
}

/// Bytes as a report shows them: the text among them as it is, and a byte that is not
/// text as the escape that reads back as that byte, so nothing is lost and nothing
/// that is not text is shown as though it were.
fn escaped(bytes: &[u8]) -> String {
    let mut shown = String::with_capacity(bytes.len());
    let mut rest = bytes;
    while !rest.is_empty() {
        match std::str::from_utf8(rest) {
            Ok(text) => {
                shown.push_str(text);
                break;
            }
            Err(broken) => {
                let (text, unreadable) = rest.split_at(broken.valid_up_to());
                let bad = broken.error_len().unwrap_or(unreadable.len());
                shown.push_str(std::str::from_utf8(text).unwrap_or_default());
                for byte in &unreadable[..bad] {
                    write!(shown, "\\x{byte:02x}").expect("writing into a String cannot fail");
                }
                rest = &unreadable[bad..];
            }
        }
    }
    shown
}

/// What a comparison is worth: the score it awards and the sentences a report shows
/// for it.
#[derive(Debug, Clone, PartialEq)]
pub struct Comparison {
    /// The score the comparison awards, which is the whole score or none of it.
    pub outcome: f64,
    /// The text a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
}

impl Comparison {
    /// What a comparison of any kind is worth, told by whether it found a difference:
    /// the same answer for every comparison, so that a task type choosing between them
    /// is choosing what a difference means and not what it is worth.
    #[must_use]
    pub fn of(difference: Result<(), Difference>) -> Self {
        let right = difference.is_ok();
        let message = if right {
            StockMessage::Success
        } else {
            StockMessage::Wrong
        };
        Self {
            outcome: if right { FULL_CREDIT } else { NO_CREDIT },
            text: vec![message.text().to_owned()],
        }
    }
}
