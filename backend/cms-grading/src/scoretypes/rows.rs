//! One row of a details table: the testcase's sentence, its report, and its figures.
//!
//! A row exists in one of two states, and the feedback level decides which rows a reader is
//! given. A row whose outcome they may see is drawn with the class its sentence earns and,
//! at `Full`, the time and memory the run was measured with; a row they may not see is a
//! blank of as many columns as the table has, or nothing at all at `OI Restricted`, where a
//! contestant is shown neither the outcome nor that the testcase was there.
//!
//! The time cell is where a run that was stopped by its limit says so: it shows the limit it
//! passed, with the `>` the reference writes, rather than the time it was charged. That is a
//! fact about the run, and the only place a report distinguishes "slow" from "too slow".

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt::Write as _;

use cms_db::FeedbackLevel;

use super::html::BLANK;
use super::submission::{Row, Testcase};
use super::text::{escape, format_status_text};
use super::units::{format_duration, format_size};

/// The table head, which gains the two columns only a full report shows.
pub(super) fn head_html(html: &mut String, level: FeedbackLevel, indent: &str) {
    let _ = writeln!(html, "{indent}<thead>");
    let _ = writeln!(html, "{indent}    <tr>");
    let _ = writeln!(html, "{indent}        <th class=\"idx\">#</th>");
    let _ = writeln!(html, "{indent}        <th class=\"outcome\">Outcome</th>");
    let _ = writeln!(html, "{indent}        <th class=\"details\">Details</th>");
    if level == FeedbackLevel::Full {
        let _ = writeln!(
            html,
            "{indent}        <th class=\"execution-time\">Execution time</th>"
        );
        let _ = writeln!(
            html,
            "{indent}        <th class=\"memory-used\">Memory used</th>"
        );
    }
    let _ = writeln!(html, "{indent}    </tr>");
    let _ = writeln!(html, "{indent}</thead>");
}

/// One testcase row of a subtask, or the blank row that stands in for it.
pub(super) fn row_html(html: &mut String, row: &Row, position: usize, level: FeedbackLevel) {
    match row {
        Row::Shown(testcase) if shown(testcase, level) => {
            shown_row_html(html, testcase, position, level);
        }
        Row::Shown(_) | Row::Hidden { .. } if level == FeedbackLevel::OiRestricted => {}
        Row::Shown(_) | Row::Hidden { .. } => {
            // A full report has four columns for a row, and a restricted one two.
            let columns = if level == FeedbackLevel::Full { 4 } else { 2 };
            let _ = writeln!(html, "                <tr class=\"undefined\">");
            let _ = writeln!(
                html,
                "                    <td class=\"idx\">{position}</td>"
            );
            let _ = writeln!(
                html,
                "                    <td colspan=\"{columns}\">{BLANK}</td>"
            );
            let _ = writeln!(html, "                </tr>");
        }
    }
}

/// One row whose outcome this reader may see.
fn shown_row_html(html: &mut String, testcase: &Testcase, position: usize, level: FeedbackLevel) {
    let _ = writeln!(
        html,
        "                <tr class=\"{}\">",
        outcome_class(&testcase.outcome)
    );
    let _ = writeln!(
        html,
        "                    <td class=\"idx\">{position}</td>"
    );
    let _ = writeln!(
        html,
        "                    <td class=\"outcome\">{}</td>",
        escape(&testcase.outcome)
    );
    let _ = writeln!(
        html,
        "                    <td class=\"details\">{}</td>",
        escape(&format_status_text(&testcase.text))
    );
    if level == FeedbackLevel::Full {
        duration_cell(html, testcase);
        memory_cell(html, testcase);
    }
    let _ = writeln!(html, "                </tr>");
}

/// Whether a testcase's outcome is shown at this level.
fn shown(testcase: &Testcase, level: FeedbackLevel) -> bool {
    match level {
        FeedbackLevel::Full => true,
        FeedbackLevel::Restricted => testcase.show_in_restricted_feedback,
        FeedbackLevel::OiRestricted => testcase.show_in_oi_restricted_feedback,
    }
}

/// The class a testcase's row is drawn with, from the sentence it is shown with.
pub(super) fn outcome_class(outcome: &str) -> &'static str {
    match outcome {
        "Correct" => "correct",
        "Not correct" => "notcorrect",
        _ => "partiallycorrect",
    }
}

/// The time a run was charged, or that it was stopped by the limit it ran past.
fn duration_cell(html: &mut String, testcase: &Testcase) {
    let shown = if testcase.time_limit_was_exceeded {
        testcase
            .time_limit
            .map(|limit| format!("&gt; {}", format_duration(limit)))
    } else {
        testcase.time.map(format_duration)
    };
    let shown = shown.unwrap_or_else(|| BLANK.to_owned());
    let _ = writeln!(
        html,
        "                    <td class=\"execution-time\">{shown}</td>"
    );
}

/// The memory a run used, in the largest unit that reads well.
fn memory_cell(html: &mut String, testcase: &Testcase) {
    let shown = testcase
        .memory
        .map_or_else(|| BLANK.to_owned(), format_size);
    let _ = writeln!(
        html,
        "                    <td class=\"memory-used\">{shown}</td>"
    );
}
