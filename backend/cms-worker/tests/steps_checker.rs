//! The checker a dataset supplies, and the standard manager output it is held to.
//!
//! Every fixture is a manager output or a pair of limits a test wrote, so every
//! answer is decided from bytes in a string: nothing is launched, nothing sleeps, and
//! nothing is timed.

use std::time::Duration;

use cms_worker::sandbox::Options;
use cms_worker::steps::{
    checker_command, extract_verdict, judge_trusted_run, CheckerError, StockMessage, TrustedLimits,
    TrustedRun, Verdict, CHECKER_FILENAME, CORRECT_OUTPUT_FILENAME, INPUT_FILENAME,
};
use cms_worker::ExitStatus;

/// The score, the contestant's text and the administrator's text a manager output is
/// read as, and the refusal of one that says neither.
fn read(stdout: &[u8], stderr: &[u8]) -> Result<Verdict, CheckerError> {
    extract_verdict(stdout, stderr)
}

#[test]
fn a_checker_is_run_as_a_program_of_its_own_over_the_three_files_it_reads() {
    assert_eq!(
        (INPUT_FILENAME, CORRECT_OUTPUT_FILENAME, CHECKER_FILENAME),
        ("input.txt", "correct_output.txt", "checker")
    );
    assert_eq!(
        checker_command("user_output.txt", &[]),
        vec![
            "./checker",
            "input.txt",
            "correct_output.txt",
            "user_output.txt"
        ]
    );
    let extra = checker_command("answer.txt", &["-v".to_owned(), "-t".to_owned()]);
    assert_eq!(extra.last(), Some(&"-t".to_owned()));
    assert_eq!(extra.len(), 6);
}

#[test]
fn a_checker_is_bounded_by_the_limits_of_a_trusted_run_and_by_nothing_else() {
    let mut options = Options::default();
    TrustedLimits::new(6, Duration::from_secs(20), 512 * 1024).apply(&mut options);

    assert!(
        options.full_environment,
        "a manager is linked against an environment"
    );
    assert_eq!(options.max_processes, Some(6));
    assert_eq!(options.cpu_time, Some(Duration::from_secs(20)));
    assert_eq!(options.wall_clock_timeout, Some(Duration::from_secs(41)));
    assert_eq!(options.address_space, Some(512 * 1024));
}

#[test]
fn only_a_clean_ending_says_the_checker_itself_ran() {
    assert_eq!(
        judge_trusted_run(ExitStatus::Ok),
        TrustedRun {
            box_worked: true,
            ran: true
        }
    );
    for stopped in [
        ExitStatus::Timeout,
        ExitStatus::TimeoutWall,
        ExitStatus::Signal,
        ExitStatus::NonzeroReturn,
    ] {
        let said = judge_trusted_run(stopped);
        assert!(
            said.box_worked && !said.ran,
            "{stopped:?} is a checker that did not"
        );
    }
    for failed in [ExitStatus::SandboxError, ExitStatus::MemoryLimit] {
        let said = judge_trusted_run(failed);
        assert!(
            !said.box_worked,
            "{failed:?} is a box that cannot be vouched for"
        );
    }
}

#[test]
fn the_score_is_the_number_of_the_first_line_and_the_text_the_one_beside_it() {
    let said = read(
        b"1.0\nthe rest of the stream\n",
        b"Output is correct\nand this too\n",
    )
    .expect("a standard manager output");
    assert_eq!(
        said,
        Verdict {
            outcome: 1.0,
            text: vec!["Output is correct".to_owned()],
            admin_text: None,
        }
    );

    let half = read(b"0.5", b"  50% off  \n").expect("half a score, and a percent sign");
    assert_eq!(half.outcome, 0.5);
    assert_eq!(
        half.text,
        vec!["50%% off"],
        "a percent sign is doubled so a report cannot read it as a format"
    );
    let trimmed = read(b"1\n", b"\tindented \n").expect("a line is trimmed before it is shown");
    assert_eq!(trimmed.text, vec!["indented"]);
    let spaced = read(b"1\n", b"one\ttwo\n").expect("a tab inside a text is not a control");
    assert_eq!(spaced.text, vec!["one\ttwo"]);
}

#[test]
fn a_manager_may_name_a_stock_sentence_and_keeps_its_own_words_when_it_names_none() {
    let named = read(b"1\n", b"translate:partial\n").expect("a named sentence");
    assert_eq!(named.text, vec![StockMessage::Partial.text().to_owned()]);
    let unknown = read(b"1\n", b"translate:almost\n").expect("an unrecognized name");
    assert_eq!(unknown.text, vec!["translate:almost"]);
    assert_eq!(StockMessage::of("wrong"), Some(StockMessage::Wrong));
    assert_eq!(StockMessage::of("nothing"), None);
}

#[test]
fn the_admin_lines_are_gathered_in_the_order_they_were_written() {
    let said = read(
        b"1\n",
        b"Output is correct\nADMIN_MESSAGE:first\n\nADMIN_MESSAGE: second \nnobody asked\n",
    )
    .expect("a manager that also speaks to an administrator");
    assert_eq!(said.text, vec!["Output is correct".to_owned()]);
    assert_eq!(said.admin_text.as_deref(), Some("first second"));
}

#[test]
fn an_answer_a_report_cannot_show_is_refused_by_what_it_is() {
    assert_eq!(
        read(b"not a number\n", b""),
        Err(CheckerError::NotAFloat("not a number".to_owned()))
    );
    assert_eq!(
        read(b"", b""),
        Err(CheckerError::NotAFloat(String::new())),
        "a manager that printed nothing wrote no score"
    );
    assert_eq!(
        read(&[b'1', b'.', 0xff], b""),
        Err(CheckerError::UndecodableOutcome)
    );
    assert_eq!(read(b"1\n", &[0xff]), Err(CheckerError::UndecodableText));
    assert_eq!(read(b"1\n", b"a\0b\n"), Err(CheckerError::Control('\0')));
    assert_eq!(read(b"1\n", b"a\rb\n"), Err(CheckerError::Control('\r')));
}
