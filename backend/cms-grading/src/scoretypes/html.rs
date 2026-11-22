//! The HTML a score's details are shown as, at each of the three feedback levels.
//!
//! Two shapes, because a score type has two: a list of subtasks with their testcases, and
//! `Sum`'s single table of testcases. The markup is the reference's, tag for tag and class
//! for class, because a page that renders a correct score under the wrong class is a page a
//! contestant reads as wrong.
//!
//! The feedback level decides which rows exist rather than what they say. `Full` shows every
//! testcase with its time and memory; `Restricted` shows the public testcases the score type
//! let through and a blank row for each one it did not, so a contestant can count the
//! testcases without knowing their outcomes; `OI Restricted` shows only the ones let through
//! and no row at all for the others, which is the rule the IOI contests run under. Which
//! testcases were let through is the score type's answer, held on the row.
//!
//! A document that is absent is a report rather than a refusal: a result whose score was
//! invalidated under a running site has no details to render, and the page says so instead of
//! failing. The rows themselves are [`crate::scoretypes::rows`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt::Write as _;

use cms_db::FeedbackLevel;

use super::format::format_decimal;
use super::rows::{head_html, outcome_class, row_html};
use super::submission::{Row, ScoreDetails, Subtask, SumRow};
use super::text::{escape, format_status_text};
use super::units::{format_duration, format_size};

/// What a page says when the details it was given are absent.
const UNAVAILABLE: &str = "Score details temporarily unavailable.";
/// The word a row a reader is not shown is replaced by, and a score that is not shown.
pub(super) const BLANK: &str = "N/A";

/// The HTML a details document is shown as, at `level`.
#[must_use]
pub fn html_details(details: Option<&ScoreDetails>, level: FeedbackLevel) -> String {
    match details {
        None => UNAVAILABLE.to_owned(),
        Some(ScoreDetails::Subtasks(subtasks)) => subtasks_html(subtasks, level),
        Some(ScoreDetails::Testcases(rows)) => testcases_html(rows, level),
    }
}

/// The HTML of a group score type's details: one block per subtask.
fn subtasks_html(subtasks: &[Subtask], level: FeedbackLevel) -> String {
    let mut html = String::new();
    for subtask in subtasks {
        let (index, class, score) = summary_of(subtask);
        let _ = writeln!(html, "<div class=\"subtask {class}\">");
        let _ = writeln!(html, "    <div class=\"subtask-head\">");
        let _ = writeln!(html, "        <span class=\"title\">Subtask {index}</span>");
        let _ = writeln!(html, "        <span class=\"score\">{score}</span>");
        let _ = writeln!(html, "    </div>");
        let _ = writeln!(html, "    <div class=\"subtask-body\">");
        let _ = writeln!(html, "        <table class=\"testcase-list\">");
        head_html(&mut html, level, "        ");
        let _ = writeln!(html, "            <tbody>");
        for (position, row) in testcases_of(subtask).iter().enumerate() {
            row_html(&mut html, row, position + 1, level);
        }
        let _ = writeln!(html, "            </tbody>");
        let _ = writeln!(html, "        </table>");
        let _ = writeln!(html, "    </div>");
        let _ = writeln!(html, "</div>");
    }
    html
}

/// The subtask's number, the class its block is drawn with, and its score as shown.
fn summary_of(subtask: &Subtask) -> (usize, &'static str, String) {
    match subtask {
        Subtask::Scored {
            index,
            score_fraction,
            score,
            max_score,
            ..
        } => (
            *index,
            fraction_class(*score_fraction),
            format!(
                "({} / {})",
                format_decimal(*score),
                format_decimal(*max_score)
            ),
        ),
        // A subtask whose weighting is not shown, because some of it is not public.
        Subtask::Unscored { index, .. } => (*index, "undefined", format!("({BLANK})")),
    }
}

/// The class a subtask's fraction is drawn with.
fn fraction_class(fraction: f64) -> &'static str {
    if fraction >= 1.0 {
        "correct"
    } else if fraction <= 0.0 {
        "notcorrect"
    } else {
        "partiallycorrect"
    }
}

/// A subtask's testcases.
fn testcases_of(subtask: &Subtask) -> &[Row] {
    match subtask {
        Subtask::Scored { testcases, .. } | Subtask::Unscored { testcases, .. } => testcases,
    }
}

/// The HTML of `Sum`'s details: one table of testcases and no subtask around it.
fn testcases_html(rows: &[SumRow], level: FeedbackLevel) -> String {
    let mut html = String::new();
    let _ = writeln!(html, "<table class=\"testcase-list\">");
    head_html(&mut html, level, "    ");
    let _ = writeln!(html, "    <tbody>");
    for (position, row) in rows.iter().enumerate() {
        sum_row_html(&mut html, row, position + 1, level);
    }
    let _ = writeln!(html, "    </tbody>");
    let _ = writeln!(html, "</table>");
    html
}

/// One testcase row of `Sum`'s table, or the blank row that stands in for it.
fn sum_row_html(html: &mut String, row: &SumRow, position: usize, level: FeedbackLevel) {
    let SumRow::Shown {
        outcome,
        text,
        time,
        memory,
        ..
    } = row
    else {
        let _ = writeln!(html, "        <tr class=\"undefined\">");
        let _ = writeln!(html, "            <td colspan=\"5\">{BLANK}</td>");
        let _ = writeln!(html, "        </tr>");
        return;
    };
    let _ = writeln!(html, "        <tr class=\"{}\">", outcome_class(outcome));
    let _ = writeln!(html, "            <td class=\"idx\">{position}</td>");
    let _ = writeln!(
        html,
        "            <td class=\"outcome\">{}</td>",
        escape(outcome)
    );
    let _ = writeln!(
        html,
        "            <td class=\"details\">{}</td>",
        escape(&format_status_text(text))
    );
    if level == FeedbackLevel::Full {
        let shown = time.map_or_else(|| BLANK.to_owned(), format_duration);
        let _ = writeln!(
            html,
            "            <td class=\"execution-time\">{shown}</td>"
        );
        let shown = memory.map_or_else(|| BLANK.to_owned(), format_size);
        let _ = writeln!(html, "            <td class=\"memory-used\">{shown}</td>");
    }
    let _ = writeln!(html, "        </tr>");
}
