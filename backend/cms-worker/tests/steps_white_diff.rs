//! An answer compared with the one a dataset says is right, both ways.
//!
//! Every fixture is a pair of answers a test wrote, so every comparison is decided
//! from bytes in a string: nothing is launched, nothing is read from a disk, and
//! nothing is timed.

use cms_worker::steps::{exact_diff, white_diff, Comparison, Difference};

/// How many bytes of a line a report is shown of it.
const REPORT_LIMIT: usize = 100;

#[test]
fn two_answers_that_differ_only_in_whitespace_are_the_same() {
    assert_eq!(white_diff(b"1   2\n3\n", b" 1 2 \n\t3\t\n\n  \n"), Ok(()));
    assert_eq!(
        white_diff(b"", b"   \n\n"),
        Ok(()),
        "and neither holds an answer"
    );
    assert_ne!(
        white_diff(b"1 2\n3\n", b"12\n3\n"),
        Ok(()),
        "whitespace inside a line is part of the answer"
    );
}

#[test]
fn a_line_that_says_something_else_is_named_by_its_number() {
    let wrong = white_diff(b"1\n2 3\n", b"1\n2 4\n").expect_err("the second line differs");
    assert_eq!(
        wrong,
        Difference::Line {
            number: 2,
            expected: "2 4".to_owned(),
            found: "2 3".to_owned(),
        }
    );
    assert_eq!(wrong.to_string(), "Expected `2 4`, found `2 3` on line 2");
}

#[test]
fn a_line_too_long_for_a_report_is_shown_cut_and_says_so() {
    let long = "a".repeat(REPORT_LIMIT + 50);
    let cut = exact_diff(
        format!("{long}\n").as_bytes(),
        format!("{long}b\n").as_bytes(),
    )
    .expect_err("the last byte of a long line differs");
    let Difference::Line { number, found, .. } = cut else {
        panic!("a byte that differs is reported as the line it is on");
    };
    assert_eq!(number, 1);
    assert_eq!(found.chars().count(), REPORT_LIMIT + 3);
    assert!(
        found.ends_with("..."),
        "and it says that it is not all of it"
    );
}

#[test]
fn an_answer_that_says_more_and_one_that_says_less_are_told_apart() {
    assert_eq!(white_diff(b"1\n2\n", b"1\n"), Err(Difference::TooLong));
    assert_eq!(white_diff(b"1\n", b"1\n2\n"), Err(Difference::TooShort));
    assert_eq!(
        white_diff(b"1\n\n\n", b"1\n"),
        Ok(()),
        "a blank line is not an answer"
    );
    assert_eq!(
        Difference::TooLong.to_string(),
        "Contestant output too long"
    );
    assert_eq!(
        Difference::TooShort.to_string(),
        "Contestant output too short"
    );
}

#[test]
fn the_byte_comparison_stops_at_the_first_byte_that_differs() {
    assert_eq!(exact_diff(b"1\n2\n", b"1\n2\n"), Ok(()));
    let spacing = exact_diff(b"1\n2\n", b"1\n 2\n").expect_err("a space is a byte too");
    assert_eq!(
        spacing,
        Difference::Line {
            number: 2,
            expected: " 2".to_owned(),
            found: "2".to_owned()
        }
    );
    let shorter = exact_diff(b"1\n", b"1\n2\n").expect_err("the correct answer has a line more");
    assert_eq!(
        shorter,
        Difference::Line {
            number: 2,
            expected: "2".to_owned(),
            found: String::new()
        }
    );
    assert_eq!(
        white_diff(b"1\n", b"1\n2\n"),
        Err(Difference::TooShort),
        "and the diff says the same thing in its own words"
    );
}

#[test]
fn a_comparison_is_worth_the_whole_score_or_nothing() {
    let right = Comparison::of(white_diff(b"1 2\n", b"1  2\n"));
    assert_eq!(
        (right.outcome, right.text),
        (1.0, vec!["Output is correct".to_owned()])
    );
    let wrong = Comparison::of(white_diff(b"1 2\n", b"1 3\n"));
    assert_eq!(
        (wrong.outcome, wrong.text),
        (0.0, vec!["Output isn't correct".to_owned()])
    );
    assert_eq!(
        Comparison::of(exact_diff(b"1 2\n", b"1  2\n")).outcome,
        0.0,
        "which is what tells the two comparisons apart"
    );
}
