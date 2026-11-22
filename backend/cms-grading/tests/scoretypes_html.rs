//! What the two documents are rendered as, at each of the three feedback levels.
//!
//! The rules pinned here are the ones a contest decides on: which testcase a partial
//! subtask shows at `Restricted` and at `OI Restricted`, whether a subtask a contestant
//! cannot see all of is scored in their document at all, and the class each subtask is
//! drawn with. The rows counted are the reference's: for a two-testcase subtask whose
//! second testcase scored half, `Restricted` shows two rows and `OI Restricted` one.

#[path = "scoretypes_helpers.rs"]
mod helpers;

use cms_db::FeedbackLevel;
use cms_grading::scoretypes::{html_details, Evaluated, Scored, Submission};

use helpers::{groups, score_type, submission, thresholds};

/// The block one subtask is rendered as, from its opening div to the next one's.
fn block(html: &str, index: usize) -> &str {
    let marker = "<div class=\"subtask ";
    let starts: Vec<usize> = html.match_indices(marker).map(|(at, _)| at).collect();
    let start = starts[index];
    let end = starts.get(index + 1).copied().unwrap_or(html.len());
    &html[start..end]
}

/// A subtask's body, which is where its rows are.
fn body(html: &str, index: usize) -> &str {
    let block = block(html, index);
    block.split_once("<tbody>").expect("a subtask has a body").1
}

#[test]
fn a_full_report_shows_every_testcase_with_its_time_and_memory() {
    let scored = score_half();
    let html = html_details(Some(&scored.details), FeedbackLevel::Full);
    let second = block(&html, 1);
    assert!(second.contains("<th class=\"execution-time\">Execution time</th>"));
    assert!(second.contains("<th class=\"memory-used\">Memory used</th>"));
    assert_eq!(body(&html, 1).matches("<tr class=").count(), 2);
    assert!(second.contains("<td class=\"execution-time\">0.500 sec</td>"));
    assert!(second.contains("<td class=\"memory-used\">100 bytes</td>"));
}

#[test]
fn a_restricted_report_shows_the_public_testcases_up_to_the_lowest_scoring_one() {
    let scored = score_half();
    let html = html_details(Some(&scored.details), FeedbackLevel::Restricted);
    let second = body(&html, 1);
    assert_eq!(
        second.matches("<tr class=").count(),
        2,
        "1_0 scored a whole and 1_1 scored half, and the lowest one is the second"
    );
    assert!(second.contains("<td class=\"outcome\">Correct</td>"));
    assert!(second.contains("<td class=\"outcome\">Partially correct</td>"));
    assert!(!block(&html, 1).contains("Execution time"));
}

#[test]
fn an_oi_restricted_report_shows_only_the_lowest_scoring_testcase() {
    let scored = score_half();
    let html = html_details(Some(&scored.details), FeedbackLevel::OiRestricted);
    let second = body(&html, 1);
    assert_eq!(second.matches("<tr class=").count(), 1);
    assert!(second.contains("<td class=\"outcome\">Partially correct</td>"));
    assert!(!second.contains("<td class=\"outcome\">Correct</td>"));
    assert_eq!(
        body(&html, 2).matches("<tr class=").count(),
        1,
        "a hidden testcase has no row at all at this level, not even a blank one"
    );
}

#[test]
fn a_hidden_testcase_is_a_blank_row_at_both_levels_that_show_rows() {
    let scored = score_half();
    let restricted = html_details(Some(&scored.public_details), FeedbackLevel::Restricted);
    let second = body(&restricted, 2);
    assert_eq!(second.matches("<tr class=").count(), 2);
    assert!(second.contains("<tr class=\"undefined\">"));
    assert!(second.contains("<td colspan=\"2\">N/A</td>"));

    let full = html_details(Some(&scored.public_details), FeedbackLevel::Full);
    assert!(
        body(&full, 2).contains("<td colspan=\"4\">N/A</td>"),
        "a full report's blank row spans the four columns it has"
    );
    let administrator = html_details(Some(&scored.details), FeedbackLevel::Full);
    assert!(
        !body(&administrator, 2).contains("<td colspan=\"4\">"),
        "an administrator is shown the outcome rather than a blank row"
    );
}

#[test]
fn a_partial_subtask_is_drawn_by_its_fraction_and_shows_what_it_earned() {
    let scored = score_half();
    let html = html_details(Some(&scored.details), FeedbackLevel::Restricted);
    let second = block(&html, 1);
    assert!(second.starts_with("<div class=\"subtask partiallycorrect\">"));
    assert!(second.contains("<span class=\"title\">Subtask 1</span>"));
    assert!(second.contains("<span class=\"score\">(15.25 / 30.5)</span>"));
}

#[test]
fn a_subtask_worth_nothing_is_drawn_as_incorrect_and_not_as_undefined() {
    let scored = score_threshold_defaults();
    let html = html_details(Some(&scored.details), FeedbackLevel::Restricted);
    let first = block(&html, 0);
    assert!(first.starts_with("<div class=\"subtask notcorrect\">"));
    assert!(
        first.contains("<span class=\"score\">(0 / 0)</span>"),
        "zero over zero is still a score, because the fraction was kept"
    );
}

#[test]
fn a_subtask_a_contestant_cannot_see_all_of_has_no_score_on_their_page() {
    let scored = score_one_testcase_hidden();
    let html = html_details(Some(&scored.public_details), FeedbackLevel::Restricted);
    let third = block(&html, 2);
    assert!(third.starts_with("<div class=\"subtask undefined\">"));
    assert!(third.contains("<span class=\"score\">(N/A)</span>"));
}

#[test]
fn a_testcase_stopped_by_its_time_limit_is_shown_as_running_past_it() {
    let scored = score_half_with_text(vec!["Execution timed out".to_owned()]);
    let html = html_details(Some(&scored.details), FeedbackLevel::Full);
    assert!(
        html.contains("<td class=\"execution-time\">&gt; 1.000 sec</td>"),
        "the row says the limit was passed rather than how long the run took"
    );
}

#[test]
fn a_sentence_a_checker_wrote_cannot_become_markup() {
    let scored = score_half_with_text(vec!["Answer <b>not</b> \"right\" & so".to_owned()]);
    let html = html_details(Some(&scored.details), FeedbackLevel::Restricted);
    assert!(html.contains("Answer &lt;b&gt;not&lt;/b&gt; &#34;right&#34; &amp; so"));
    assert!(!html.contains("<b>"));
}

#[test]
fn a_document_that_is_absent_is_a_sentence_rather_than_a_failure() {
    assert_eq!(
        html_details(None, FeedbackLevel::Restricted),
        "Score details temporarily unavailable."
    );
}

#[test]
fn sum_renders_one_table_with_no_subtask_around_it() {
    let scored = score_type("Sum", serde_json::json!(10))
        .compute_score(&submission(&[("1_1", 0.0)]))
        .expect("every testcase is in the submission");
    let html = html_details(Some(&scored.public_details), FeedbackLevel::Restricted);
    assert!(html.starts_with("<table class=\"testcase-list\">"));
    assert!(!html.contains("<div class=\"subtask"));
    assert!(html.contains("<tr class=\"notcorrect\">"));
    assert!(
        html.contains("<td colspan=\"5\">N/A</td>"),
        "a hidden testcase's blank row is five columns wide"
    );
}

/// The submission the reference scores as 84.75: the second subtask's second testcase
/// scored half.
fn score_half() -> Scored {
    score_type("GroupMin", groups())
        .compute_score(&submission(&[("1_1", 0.5)]))
        .expect("every selected testcase is in the submission")
}

/// The same submission, with the text its rows are shown with.
fn score_half_with_text(text: Vec<String>) -> Scored {
    let submission = with_text(&submission(&[("1_1", 0.5)]), &text);
    score_type("GroupMin", groups())
        .compute_score(&submission)
        .expect("every selected testcase is in the submission")
}

/// The threshold dataset with every outcome at one, where the first subtask's zero
/// threshold is failed by an outcome of one and the subtask is worth nothing.
fn score_threshold_defaults() -> Scored {
    score_type("GroupThreshold", thresholds())
        .compute_score(&submission(&[]))
        .expect("every selected testcase is in the submission")
}

/// The dataset with a quarter of the third subtask earned, whose weight a contestant
/// therefore cannot be shown.
fn score_one_testcase_hidden() -> Scored {
    score_type("GroupMin", groups())
        .compute_score(&submission(&[("2_0", 0.25)]))
        .expect("every selected testcase is in the submission")
}

/// The submission with every testcase's report replaced by `text`.
fn with_text(submission: &Submission, text: &[String]) -> Submission {
    let testcases: Vec<Evaluated> = submission
        .testcases
        .iter()
        .map(|evaluated| Evaluated {
            text: text.to_vec(),
            ..evaluated.clone()
        })
        .collect();
    Submission {
        testcases,
        ..submission.clone()
    }
}
