//! What a score looks like: the rounding a task publishes at, the digits a panel shows,
//! and the string the ranking server reads.
//!
//! Every expected value here was produced by the reference implementation — Python's
//! `round`, Babel's decimal pattern and C's `%g` — so these are the strings a contestant
//! and an administrator see today, not a new choice this port made.

use cms_grading::scoretypes::{
    escape, format_decimal, format_duration, format_general, format_score, format_size,
    format_status_text, round_at,
};

#[test]
fn a_score_is_rounded_at_the_precision_its_task_publishes() {
    assert_eq!(format_score(84.75, 100.0, 4), "84.75 / 100");
    assert_eq!(format_score(84.7551, 100.0, 2), "84.76 / 100");
    assert_eq!(format_score(0.0, 70.0, 0), "0 / 70");
    assert_eq!(
        format_score(55.0, 70.0, 4),
        "55 / 70",
        "a whole number is shown without a fraction"
    );
}

#[test]
fn a_tie_is_rounded_to_even_as_the_reference_publishes_it() {
    assert_eq!(round_at(0.125, 2), 0.12, "the second decimal stays even");
    assert_eq!(
        round_at(0.375, 2),
        0.38,
        "and the second one rounds up to stay even"
    );
    assert_eq!(round_at(2.5, 0), 2.0);
    assert_eq!(round_at(3.5, 0), 4.0);
}

#[test]
fn the_rounding_rounds_the_value_held_and_not_a_multiple_of_it() {
    assert_eq!(
        round_at(2.675, 2),
        2.67,
        "2.675 is held as 2.67499…; scaling it by a hundred lands on the tie and gives 2.68"
    );
    assert_eq!(
        format!("{:.2}", 2.675),
        "2.67",
        "the same rule the rounding is built on"
    );
}

#[test]
fn a_score_is_shown_with_its_thousands_grouped_and_at_most_three_fraction_digits() {
    assert_eq!(format_decimal(59.0), "59");
    assert_eq!(format_decimal(1234.5), "1,234.5");
    assert_eq!(format_decimal(1_000_000.0), "1,000,000");
    assert_eq!(
        format_decimal(1.23456),
        "1.235",
        "the panel's pattern cuts at three fraction digits"
    );
    assert_eq!(format_decimal(0.0005), "0");
}

#[test]
fn the_ranking_string_is_six_significant_digits() {
    assert_eq!(format_general(0.0), "0");
    assert_eq!(format_general(10.5), "10.5");
    assert_eq!(format_general(59.0), "59");
    assert_eq!(format_general(100.0), "100");
    assert_eq!(format_general(15.25), "15.25");
    assert_eq!(format_general(123_456.789), "123457");
    assert_eq!(format_general(1_000_000.0), "1e+06");
    assert_eq!(format_general(1_234_567.0), "1.23457e+06");
    assert_eq!(format_general(999_999.5), "1e+06");
    assert_eq!(format_general(0.0001), "0.0001");
    assert_eq!(format_general(0.00001), "1e-05");
}

#[test]
fn a_duration_is_shown_to_the_millisecond() {
    assert_eq!(format_duration(0.5), "0.500 sec");
    assert_eq!(format_duration(0.0), "0.000 sec");
    assert_eq!(format_duration(59.9999), "60.000 sec");
    assert_eq!(format_duration(1234.5), "1,234.500 sec");
}

#[test]
fn a_size_is_shown_in_the_largest_binary_unit_that_reads_well() {
    assert_eq!(format_size(1), "1 byte");
    assert_eq!(format_size(100), "100 bytes");
    assert_eq!(format_size(1023), "1,023 bytes");
    assert_eq!(format_size(1024), "1.00 KiB");
    assert_eq!(format_size(1536), "1.50 KiB");
    assert_eq!(format_size(1_048_576), "1.00 MiB");
    assert_eq!(format_size(1_234_567), "1.18 MiB");
    assert_eq!(format_size(1_073_741_824), "1.00 GiB");
}

#[test]
fn a_report_sentence_is_filled_in_with_the_arguments_it_names() {
    assert_eq!(
        format_status_text(&["Execution timed out".to_owned()]),
        "Execution timed out"
    );
    assert_eq!(
        format_status_text(&[
            "Evaluation didn't produce file %s".to_owned(),
            "answer.txt".to_owned()
        ]),
        "Evaluation didn't produce file answer.txt"
    );
    assert_eq!(
        format_status_text(&["Execution killed by signal %(signal)d".to_owned()]),
        "N/A",
        "a sentence naming its argument by keyword is refused, as the reference refuses it"
    );
    assert_eq!(
        format_status_text(&["Execution timed out".to_owned(), "1".to_owned()]),
        "N/A",
        "and so is an argument a sentence has no place for"
    );
}

#[test]
fn a_sentence_is_escaped_before_it_reaches_a_page() {
    assert_eq!(escape("a<b>c&d\"e'f"), "a&lt;b&gt;c&amp;d&#34;e&#39;f");
}
