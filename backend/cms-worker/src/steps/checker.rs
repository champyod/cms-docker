//! The checker a dataset supplies, run as a trusted step and read for what it says.
//!
//! A checker is a program the dataset holds, handed the input, the correct answer and
//! the submission's own answer, and it is worth what it prints. It still runs inside a
//! box, and for that reason rather than for trust: a manager with a bug in it, or a
//! configuration naming one that does not exist, must cost a worker a bounded run and
//! nothing more, so the three limits here are fixed rather than a dataset's.
//!
//! What the checker printed is a standard manager output: one line on its standard
//! output holding a number, and lines beside it on its standard error, of which the
//! first is the text a contestant is shown and every line opening with
//! `ADMIN_MESSAGE:` joins the text an administrator alone is shown.
//!
//! # Errors
//!
//! [`CheckerError`], and only that: the outcome line that is not a number, the two
//! lines that are not text at all, and the control character a report must not be
//! shown. Every variant says which of the two streams it came from.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::time::Duration;

use crate::measure::ExitStatus;
use crate::sandbox::Options;

use super::StockMessage;

/// The file the checker is told the input is in.
pub const INPUT_FILENAME: &str = "input.txt";
/// The file the checker is told the correct answer is in.
pub const CORRECT_OUTPUT_FILENAME: &str = "correct_output.txt";
/// The name a checker is copied in under, which is also the program that is run.
pub const CHECKER_FILENAME: &str = "checker";

/// The marker a line of a manager's standard error opens with when it is for an
/// administrator rather than for a contestant.
const ADMIN_PREFIX: &str = "ADMIN_MESSAGE:";
/// The marker a manager's text opens with when it asks for a stock sentence by name.
const TRANSLATE_PREFIX: &str = "translate:";
/// How many times the CPU limit is charged against the wall clock, because a run that
/// is stopped is still charged for being stopped.
const WALL_CLOCK_MULTIPLIER: u32 = 2;
/// What stopping a trusted run costs it on top of its own limit, in seconds.
const WALL_CLOCK_GRACE: Duration = Duration::from_secs(1);

/// The three numbers a checker is held to, which bound a manager rather than a
/// submission, since a dataset's limits are the submission's own business.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedLimits {
    /// How many processes the checker may have alive at once.
    pub processes: u32,
    /// The CPU time the checker is charged, and past which it is stopped.
    pub time: Duration,
    /// The memory the checker may address, in bytes, as every other limit is.
    pub memory: u64,
}

impl TrustedLimits {
    /// The limits a checker is held to, which a caller takes from the configuration it
    /// was built with.
    #[must_use]
    pub fn new(processes: u32, time: Duration, memory: u64) -> Self {
        Self {
            processes,
            time,
            memory,
        }
    }

    /// Puts these limits on a run's options, over whatever the box already carried.
    /// The environment is kept, because a manager is a compiled program that expects
    /// the ones it was linked against, and the wall clock is the CPU limit paid twice
    /// over: a checker that is stopped is stopped by the isolate, and killing is not
    /// instant.
    pub fn apply(&self, options: &mut Options) {
        options.full_environment = true;
        options.max_processes = Some(self.processes);
        options.cpu_time = Some(self.time);
        options.wall_clock_timeout = Some(self.time * WALL_CLOCK_MULTIPLIER + WALL_CLOCK_GRACE);
        options.address_space = Some(self.memory);
    }
}

/// What one trusted run's ending says about the run that was made inside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedRun {
    /// Whether the box worked, so that what the run reported can be believed.
    pub box_worked: bool,
    /// Whether the run itself terminated correctly, as against one that was stopped,
    /// killed or returned non-zero. It means nothing unless the box worked.
    pub ran: bool,
}

/// What a run's status says about a trusted step: a run stopped for the CPU or the
/// wall clock, killed by a signal or returned non-zero is the box working and the
/// checker not. The reference's table of the same has no arm for a run stopped for
/// memory, and a status it cannot match is one it cannot vouch for, so that one is a
/// box that did not work rather than a checker that misbehaved.
#[must_use]
pub fn judge_trusted_run(status: ExitStatus) -> TrustedRun {
    let worked = matches!(
        status,
        ExitStatus::Ok
            | ExitStatus::Timeout
            | ExitStatus::TimeoutWall
            | ExitStatus::Signal
            | ExitStatus::NonzeroReturn
    );
    TrustedRun {
        box_worked: worked,
        ran: worked && status == ExitStatus::Ok,
    }
}

/// The command a checker is run as: the program, the input, the correct answer, the
/// submission's own answer, and any extra arguments the task type passed on.
#[must_use]
pub fn checker_command(output_filename: &str, extra_args: &[String]) -> Vec<String> {
    let mut command = vec![
        format!("./{CHECKER_FILENAME}"),
        INPUT_FILENAME.to_owned(),
        CORRECT_OUTPUT_FILENAME.to_owned(),
        output_filename.to_owned(),
    ];
    command.extend_from_slice(extra_args);
    command
}

/// What a standard manager output says: the score, the text a contestant is shown,
/// and the text only an administrator is shown.
#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    /// The score the checker awarded, which is a number it chose and is read as one.
    pub outcome: f64,
    /// The text a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// The text only an administrator is shown, and never translated.
    pub admin_text: Option<String>,
}

/// Why a standard manager output could not be read as one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckerError {
    /// The line holding the outcome is not text.
    UndecodableOutcome,
    /// The line holding the text is not text.
    UndecodableText,
    /// The text carries a control character a report must never be shown.
    Control(char),
    /// The line holding the outcome is text, and is not a number.
    NotAFloat(String),
}

impl fmt::Display for CheckerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UndecodableOutcome => write!(f, "the outcome is not valid UTF-8"),
            Self::UndecodableText => write!(f, "the text is not valid UTF-8"),
            Self::Control(character) => {
                let code = *character as u32;
                write!(f, "invalid character in the text: 0x{code:02x}")
            }
            Self::NotAFloat(outcome) => write!(f, "the outcome is not a number: {outcome}"),
        }
    }
}

impl std::error::Error for CheckerError {}

/// Reads a standard manager output: the score on the first line of the standard
/// output, and the text beside it on the standard error. An empty stream is not
/// refused for being empty, because that is what a manager that printed nothing
/// wrote: the outcome is then no number, and an empty text is shown as one.
pub fn extract_verdict(stdout: &[u8], stderr: &[u8]) -> Result<Verdict, CheckerError> {
    let (first, _) = split_first_line(stdout);
    let outcome = std::str::from_utf8(first).map_err(|_| CheckerError::UndecodableOutcome)?;
    let score = outcome
        .trim()
        .parse()
        .map_err(|_| CheckerError::NotAFloat(outcome.trim().to_owned()))?;
    let (first, rest) = split_first_line(stderr);
    let text = std::str::from_utf8(first).map_err(|_| CheckerError::UndecodableText)?;
    Ok(Verdict {
        outcome: score,
        text: vec![translated(&sanitize(text.trim())?)],
        admin_text: admin_text(rest)?,
    })
}

/// The line before the first newline and everything after it, as the reference reads
/// a stream: one line, then the rest, whether or not either ends in a newline.
fn split_first_line(stream: &[u8]) -> (&[u8], &[u8]) {
    match stream.iter().position(|byte| *byte == b'\n') {
        Some(end) => (&stream[..end], &stream[end + 1..]),
        None => (stream, &[]),
    }
}

/// A manager's text made safe to show: a percent sign doubled so that it is never read
/// as a format of its own later, and a control character refused, because a report is
/// no place to carry one.
///
/// The three refused runs are the controls below the tab, the controls above it, and
/// the delete with the block above it. The tab is not one, so a text may be indented.
fn sanitize(text: &str) -> Result<String, CheckerError> {
    let refused = text.chars().find(|character| refused(*character));
    if let Some(character) = refused {
        return Err(CheckerError::Control(character));
    }
    Ok(text.replace('%', "%%"))
}

/// Whether a character is one a report must not carry.
fn refused(character: char) -> bool {
    matches!(character, '\u{0}'..='\u{8}' | '\u{a}'..='\u{1f}' | '\u{7f}'..='\u{bf}')
}

/// The sentence a manager's text becomes: the stock one it asked for by name, and its
/// own text otherwise, an unrecognized name included, since a manager that asked for
/// a sentence this table does not hold has still written something to show.
fn translated(text: &str) -> String {
    let Some(asked) = text.strip_prefix(TRANSLATE_PREFIX) else {
        return text.to_owned();
    };
    StockMessage::of(asked.trim())
        .map_or_else(|| text.to_owned(), |message| message.text().to_owned())
}

/// The administrator's text, gathered from the lines naming it in the order written.
/// A line that is blank, or names nothing this step knows, is no line at all.
fn admin_text(rest: &[u8]) -> Result<Option<String>, CheckerError> {
    let mut said: Option<String> = None;
    for line in rest.split(|byte| *byte == b'\n') {
        let line = std::str::from_utf8(line).map_err(|_| CheckerError::UndecodableText)?;
        let Some(admin) = line.trim().strip_prefix(ADMIN_PREFIX) else {
            continue;
        };
        let admin = sanitize(admin.trim())?;
        said = Some(match said {
            Some(already) => already + " " + &admin,
            None => admin,
        });
    }
    Ok(said)
}
