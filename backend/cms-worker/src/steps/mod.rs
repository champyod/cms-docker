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
//! # Errors
//!
//! [`CheckerError`], and only that: an outcome line that is not a number, and text
//! carrying a character a report must never be shown. A comparison has nothing to
//! fail on — two answers that are not the same is a statement about the submission,
//! not a fault of the worker — so that is [`Difference`], and what a report says
//! about it is the caller's to write.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod checker;
mod white_diff;

pub use checker::{
    checker_command, extract_verdict, judge_trusted_run, CheckerError, TrustedLimits, TrustedRun,
    Verdict, CHECKER_FILENAME, CORRECT_OUTPUT_FILENAME, INPUT_FILENAME,
};
pub use white_diff::{exact_diff, white_diff, Comparison, Difference};

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

/// The three words a manager spells when it asks for a stock sentence by name.
const NAME_SUCCESS: &str = "success";
const NAME_PARTIAL: &str = "partial";
const NAME_WRONG: &str = "wrong";

/// The sentences themselves, as a report shows them, which are the ones the
/// reference's translation table holds.
const TEXT_SUCCESS: &str = "Output is correct";
const TEXT_PARTIAL: &str = "Output is partially correct";
const TEXT_WRONG: &str = "Output isn't correct";

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

    /// The sentence itself, which is what a report shows.
    #[must_use]
    pub const fn text(self) -> &'static str {
        match self {
            Self::Success => TEXT_SUCCESS,
            Self::Partial => TEXT_PARTIAL,
            Self::Wrong => TEXT_WRONG,
        }
    }
}
