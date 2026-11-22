//! What a score's report says, and the escaping that keeps a submission out of it.
//!
//! A report is a list of strings: the sentence first, then the arguments that sentence
//! names, which is how the reference stores it in a `text` column. Filling them in is this
//! module's first half. It is also where a manager's own words reach a contestant's page,
//! so a message that cannot be filled in is replaced by `N/A` rather than shown half
//! substituted: the reference's own formatter does the same on any failure.
//!
//! The other half is the escaping. Every string a page shows goes through a template that
//! escapes it, so a sentence a checker printed cannot open a tag in a contestant's browser.
//! The entities are the ones the reference's template engine writes, because they are what
//! a page's diff against the reference looks like when nothing has changed.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt::Write as _;

/// What a report says for a message it cannot fill in, as the reference does on failure.
const UNAVAILABLE: &str = "N/A";

/// A stored report as a sentence: the first string with the rest substituted into it.
///
/// `%s` takes the next argument as it is and `%d` takes one that is a number; `%%` is a
/// percent sign. A message naming its arguments by keyword is not read, and says so the
/// way the reference does, because it is the one form whose failure would otherwise be a
/// half-substituted sentence.
#[must_use]
pub fn format_status_text(text: &[String]) -> String {
    let Some((message, arguments)) = text.split_first() else {
        return UNAVAILABLE.to_owned();
    };
    let mut formatted = String::with_capacity(message.len());
    let mut arguments = arguments.iter();
    let mut message = message.chars().peekable();
    while let Some(character) = message.next() {
        if character != '%' {
            formatted.push(character);
            continue;
        }
        match message.peek() {
            Some('%') => {
                message.next();
                formatted.push('%');
            }
            Some('s') => {
                message.next();
                let Some(argument) = arguments.next() else {
                    return UNAVAILABLE.to_owned();
                };
                formatted.push_str(argument);
            }
            Some('d') => {
                message.next();
                let Some(number) = arguments.next().and_then(|a| a.trim().parse::<i64>().ok())
                else {
                    return UNAVAILABLE.to_owned();
                };
                let _ = write!(formatted, "{number}");
            }
            _ => return UNAVAILABLE.to_owned(),
        }
    }
    if arguments.next().is_some() {
        // Python refuses an argument a sentence has no place for; dropping it would be silent.
        return UNAVAILABLE.to_owned();
    }
    formatted
}

/// Text as an HTML page shows it, with the five characters that would be markup escaped.
#[must_use]
pub fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\'' => escaped.push_str("&#39;"),
            '"' => escaped.push_str("&#34;"),
            _ => escaped.push(character),
        }
    }
    escaped
}
