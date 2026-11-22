//! What a submission is worth once it has answered: the checker that reads the
//! answer, and the comparison of an answer with the one a dataset says is right.
//!
//! Both are as pure as they can be, so a verdict is decided by the bytes a run wrote
//! and the numbers a checker printed, with no box of their own. What a task type does
//! around them — where a box is made, which limits a checker is held to, where its
//! two streams are read back — is the task type's own business, and every value these
//! two modules need is handed to them rather than looked up.
//!
//! Two things are shared between them. A checker runs inside a box like any other run,
//! and its own limits are fixed rather than a dataset's, so that a mistake in a
//! manager or in a configuration is bounded rather than able to bring the worker down:
//! that is [`TrustedLimits`]. And the sentences a report shows for a submission are a
//! small closed table, which a checker may ask for by name instead of writing one
//! itself: that is [`StockMessage`].
//!
//! A checker is the one thing here that makes a box, since it is a program and not a
//! value; [`checker_step`] is that run's orchestration, and what it hands back is
//! either a [`Verdict`] or nothing where the check could not be made at all.
//!
//! # Errors
//!
//! [`CheckerError`], [`StepError`] and nothing else: an outcome line that is not a
//! number, text carrying a character a report must never be shown, and a file or a run
//! the worker could not carry out. A comparison has nothing to fail on — two answers
//! that are not the same is a statement about the submission, not a fault of the
//! worker — so that is [`Difference`], and what a report says about it is the caller's
//! to write.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod checker;
mod escape;
mod trusted;
mod white_diff;

pub use checker::{
    checker_command, extract_verdict, judge_trusted_run, CheckerError, TrustedLimits, TrustedRun,
    Verdict, CHECKER_FILENAME, CORRECT_OUTPUT_FILENAME, INPUT_FILENAME,
};
pub use trusted::{checker_step, Check, StepError};
pub use white_diff::{exact_diff, white_diff, Comparison, Difference};

use crate::messages::EVALUATION_MESSAGES;

/// A sentence a report shows for a submission, which a checker may name rather than
/// write, and which a comparison names on the submission's behalf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StockMessage {
    /// The answer is the right one.
    Success,
    /// The answer is right in part.
    Partial,
    /// The answer is not the right one.
    Wrong,
}

/// The three words a manager spells when it asks for a stock sentence by name, which are
/// also the shorthands the evaluation table files those sentences under.
const NAME_SUCCESS: &str = "success";
const NAME_PARTIAL: &str = "partial";
const NAME_WRONG: &str = "wrong";

impl StockMessage {
    /// The sentence of that name, or `None` for a word that names none of them: a
    /// name the table does not hold is left for the manager to have written itself.
    #[must_use]
    pub fn of(name: &str) -> Option<Self> {
        match name {
            NAME_SUCCESS => Some(Self::Success),
            NAME_PARTIAL => Some(Self::Partial),
            NAME_WRONG => Some(Self::Wrong),
            _ => None,
        }
    }

    /// The sentence itself, which is the evaluation table's and is what a report shows.
    #[must_use]
    pub fn text(self) -> &'static str {
        let shorthand = match self {
            Self::Success => NAME_SUCCESS,
            Self::Partial => NAME_PARTIAL,
            Self::Wrong => NAME_WRONG,
        };
        EVALUATION_MESSAGES.get(shorthand).message().template()
    }
}
