//! How an answer of a [`BatchAndOutput`](super::BatchAndOutput) task is put
//! together, and the two readings of a job that putting together depends on.
//!
//! Which shape an answer has was decided before it was built, in the order the
//! reference decides an answer in, so each shape is built by one constructor here.
//! The score, the sentences and the words a checker is told are therefore written
//! once each, rather than spread across the places that hand an answer back.
//!
//! The other two functions read what that decision needs read first: which
//! testcases a parameter listed as output-only, and whether a submission carries
//! anything to compile, since an answer file is not a source.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeSet;

use serde_json::Value;

use cms_proto::DigestMap;

use super::batch::{TaskError, SOURCE_PLACEHOLDER};
use super::batch_and_output::{Answer, Origin};
use super::output_only::{NOT_CARRIED, NO_CREDIT};
use super::Evaluation;
use crate::stage::FileDigest;

impl Answer {
    /// What a testcase the submission carried an answer for is worth: the digest the
    /// answer is kept under, and the word a checker is told which kind it holds.
    pub(super) fn carried(answer: FileDigest, kind: &'static str) -> Self {
        Self {
            success: true,
            outcome: None,
            text: Vec::new(),
            stats: None,
            sandboxes: Vec::new(),
            origin: Some(Origin::Carried(answer)),
            extra_args: vec![kind.to_owned()],
        }
    }

    /// What a testcase nothing answered is worth: a score of zero and the sentence
    /// that says so, and no answer for a checker to be handed.
    pub(super) fn not_carried() -> Self {
        Self {
            success: true,
            outcome: Some(NO_CREDIT),
            text: vec![NOT_CARRIED.to_owned()],
            stats: None,
            sandboxes: Vec::new(),
            origin: None,
            extra_args: Vec::new(),
        }
    }

    /// What a run is worth as the answer it left: what the box reported, what the run
    /// was charged, and the file a comparison or a checker reads. A run that wrote no
    /// answer hands nothing on, so it is given no word either.
    pub(super) fn from_run(mut run: Evaluation, kind: &'static str) -> Self {
        let origin = run.output_file.take().map(Origin::Written);
        let extra_args = if origin.is_some() {
            vec![kind.to_owned()]
        } else {
            Vec::new()
        };
        Self {
            success: run.success,
            outcome: run.outcome,
            text: run.text,
            stats: run.stats,
            sandboxes: run.sandboxes,
            origin,
            extra_args,
        }
    }
}

/// The testcases a parameter listed as output-only: a comma-separated list of
/// codenames, where one naming none is the empty set and not the empty name.
pub(super) fn listed(entry: &Value) -> Result<BTreeSet<String>, TaskError> {
    let text = entry.as_str().ok_or(TaskError::Parameters)?;
    Ok(text
        .split(',')
        .filter(|codename| !codename.is_empty())
        .map(str::to_owned)
        .collect())
}

/// Whether a submission carries anything to compile, which is what decides whether a
/// compilation is attempted: an answer file is not a source.
pub(super) fn carries_source(files: &DigestMap) -> bool {
    files
        .keys()
        .any(|codename| codename.ends_with(SOURCE_PLACEHOLDER))
}
