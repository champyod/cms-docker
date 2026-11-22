//! The table every contestant-visible outcome sentence comes from: what it says, the
//! order it says it in, and the one sentence that cannot be shown without its argument.
//!
//! The expected strings here are transcribed from the reference by hand rather than
//! compared against themselves, so a re-worded or re-ordered entry fails here first.

use cms_grading::messages::{Sentence, COMPILATION_MESSAGES, EVALUATION_MESSAGES};
use cms_grading::scoretypes::format_status_text;

/// One entry as the reference declares it: the shorthand, the sentence, the explanation.
type Declared = (&'static str, &'static str, &'static str);

/// `grading/steps/evaluation.py`, entry by entry and in that order.
const EVALUATION_TABLE: &[Declared] = &[
    (
        "success",
        "Output is correct",
        "Your submission ran and gave the correct answer",
    ),
    (
        "partial",
        "Output is partially correct",
        "Your submission ran and gave the partially correct answer",
    ),
    (
        "wrong",
        "Output isn't correct",
        "Your submission ran, but gave the wrong answer",
    ),
    (
        "nooutput",
        "Evaluation didn't produce file %s",
        "Your submission ran, but did not write on the correct output file",
    ),
    (
        "timeout",
        "Execution timed out",
        "Your submission used too much CPU time.",
    ),
    (
        "walltimeout",
        "Execution timed out (wall clock limit exceeded)",
        "Your submission used too much total time. This might be triggered by undefined code, \
         or buffer overflow, for example. Note that in this case the CPU time visible in the \
         submission details might be much smaller than the time limit.",
    ),
    (
        "memorylimit",
        "Memory limit exceeded",
        "Your submission used too much memory.",
    ),
    (
        "signal",
        "Execution killed by signal",
        "The evaluation was killed by a signal.",
    ),
    (
        "returncode",
        "Execution failed because the return code was nonzero",
        "Your submission failed because it exited with a return code different from 0.",
    ),
];

/// `grading/steps/compilation.py`, entry by entry and in that order.
const COMPILATION_TABLE: &[Declared] = &[
    (
        "success",
        "Compilation succeeded",
        "Your submission successfully compiled to an executable.",
    ),
    (
        "fail",
        "Compilation failed",
        "Your submission did not compile correctly.",
    ),
    (
        "timeout",
        "Compilation timed out",
        "Your submission exceeded the time limit while compiling. This might be caused by an \
         excessive use of C++ templates, for example.",
    ),
    (
        "signal",
        "Compilation killed with signal %s (could be triggered by violating memory limits)",
        "Your submission was killed with the specified signal. Among other things, this might \
         be caused by exceeding the memory limit for the compilation, and in turn by an \
         excessive use of C++ templates, for example.",
    ),
];

/// The two tables, each with the entries it is expected to declare.
fn tables() -> [(
    &'static str,
    &'static [Declared],
    cms_grading::messages::MessageCollection,
); 2] {
    [
        ("evaluation", EVALUATION_TABLE, EVALUATION_MESSAGES),
        ("compilation", COMPILATION_TABLE, COMPILATION_MESSAGES),
    ]
}

#[test]
fn every_sentence_and_explanation_is_the_one_the_reference_declares() {
    for (label, expected, table) in tables() {
        assert_eq!(
            table.all().len(),
            expected.len(),
            "{label}: a different number of entries"
        );
        for (message, (shorthand, sentence, help)) in table.all().iter().zip(expected) {
            assert_eq!(message.shorthand(), *shorthand, "{label}: shorthand");
            assert_eq!(message.message().template(), *sentence, "{label}: sentence");
            assert_eq!(message.help_text(), *help, "{label}: help text");
        }
    }
}

#[test]
fn all_prints_the_entries_in_the_order_they_are_declared() {
    for (label, expected, table) in tables() {
        let printed: Vec<&str> = table
            .all()
            .iter()
            .map(|message| message.shorthand())
            .collect();
        let declared: Vec<&str> = expected
            .iter()
            .map(|(shorthand, _, _)| *shorthand)
            .collect();
        assert_eq!(printed, declared, "{label}: the help page's order");
    }
}

#[test]
fn get_answers_with_the_entry_a_shorthand_names() {
    assert_eq!(
        EVALUATION_MESSAGES.get("walltimeout").message().template(),
        "Execution timed out (wall clock limit exceeded)"
    );
    assert_eq!(
        EVALUATION_MESSAGES.get("nooutput").message(),
        Sentence::Names("Evaluation didn't produce file %s")
    );
    assert_eq!(
        COMPILATION_MESSAGES.get("fail").message().template(),
        "Compilation failed"
    );
    // The same shorthand in each table is that table's own entry, not the other's.
    assert_eq!(
        EVALUATION_MESSAGES.get("timeout").message().template(),
        "Execution timed out"
    );
    assert_eq!(
        COMPILATION_MESSAGES.get("timeout").message().template(),
        "Compilation timed out"
    );
}

#[test]
#[should_panic(expected = "Trying to get a non-existing message `nosuch'.")]
fn get_refuses_a_shorthand_the_table_does_not_hold() {
    let _ = EVALUATION_MESSAGES.get("nosuch");
}

#[test]
fn every_shorthand_is_declared_once_in_its_table() {
    for (label, _, table) in tables() {
        for (index, message) in table.all().iter().enumerate() {
            let repeats = table
                .all()
                .iter()
                .skip(index + 1)
                .filter(|other| other.shorthand() == message.shorthand())
                .count();
            assert_eq!(
                repeats,
                0,
                "{label}: `{}' is declared twice",
                message.shorthand()
            );
        }
    }
}

#[test]
fn a_sentence_with_a_hole_has_no_report_without_it() {
    for (label, _, table) in tables() {
        for message in table.all() {
            let template = message.message().template();
            let holes = template.matches("%s").count();
            match message.message() {
                Sentence::Names(_) => {
                    assert_eq!(
                        holes,
                        1,
                        "{label}: `{}' needs exactly one hole",
                        message.shorthand()
                    );
                    assert_eq!(
                        message.message().reported_naming("11").len(),
                        2,
                        "{label}: `{}' reports its sentence and its argument",
                        message.shorthand()
                    );
                }
                Sentence::Stands(_) => {
                    assert_eq!(
                        holes,
                        0,
                        "{label}: `{}' has no argument to name",
                        message.shorthand()
                    );
                    assert_eq!(
                        message.message().reported(),
                        vec![template.to_owned()],
                        "{label}: `{}' reports its sentence alone",
                        message.shorthand()
                    );
                }
            }
        }
    }
}

#[test]
fn the_missing_output_sentence_names_the_file_it_looked_for() {
    let reported = EVALUATION_MESSAGES
        .get("nooutput")
        .message()
        .reported_naming("answer.txt");
    assert_eq!(reported.len(), 2, "the sentence and the filename");
    assert_eq!(
        format_status_text(&reported),
        "Evaluation didn't produce file answer.txt"
    );
}
