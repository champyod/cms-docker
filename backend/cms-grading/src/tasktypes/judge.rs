//! The judge: an answer compared with the one the dataset says is right.
//!
//! One function decides a run — `tasktypes/util.py:216` — and its returning contract is
//! the whole of it. An answer is a path the run wrote or a digest a submission carried,
//! and exactly one of the two, so both together and neither are a refusal rather than a
//! guess. A path that is not there is a **wrong answer**: the run was asked to write a
//! file and did not, which is worth zero and is said to the contestant in those words.
//! That is deliberately not a failed check, and neither is a dataset that names a
//! checker it does not hold — that one is `success` false with no score at all, because
//! nothing was decided about the answer.
//!
//! A named checker runs in a box of its own, made for the check and closed after it,
//! since a manager is a program and a check is a run. A link is treated as no file at
//! all: the reference treats links as potential attacks, and a judge that followed one
//! would read whatever it pointed at.
//!
//! # Errors
//!
//! [`TaskError`], and only that: an answer described by both a path and a digest or by
//! neither, a dataset holding no correct answer to compare with, a store that would not
//! hand a file over, and a checker the worker could not stage or launch.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cms_db::FileDigest;

use super::TaskError;
use super::{handle, Runtime};
use crate::job::EvaluationJob;
use crate::messages::EVALUATION_MESSAGES;
use crate::stage::{Cache, CacheHandle, Stage, StageError};
use crate::steps::{checker_step, white_diff, Check, Comparison, Verdict};

/// The codename a dataset files the checker the parameters asked for under.
pub const CHECKER_CODENAME: &str = "checker";
/// The name of the box a check is made in, which the report names it by.
const CHECK_BOX: &str = "check";
/// The name the answer is copied into the check box under, which is the third argument
/// the checker is given.
const USER_OUTPUT_FILENAME: &str = "user_output.txt";

/// What a judge decided about one answer.
#[derive(Debug, Clone, PartialEq)]
pub struct Judgement {
    /// Whether the answer could be judged at all. False means the check could not be
    /// made, which is a fault of the dataset or the worker and never a wrong answer.
    pub success: bool,
    /// The score the answer earned, absent when it could not be judged.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the checker wrote none.
    pub admin_text: Option<String>,
    /// The boxes a check was made in, which the report names.
    pub sandboxes: Vec<PathBuf>,
}

/// The answer to be judged: a file a run wrote, or a digest a submission carried.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputSource {
    /// A file on this side of the box, at the path the run wrote it to.
    Path(PathBuf),
    /// A file the submission carried, in the store under this digest.
    Digest(FileDigest),
}

impl OutputSource {
    /// Exactly one of the two, which is the reference's first refusal: both together
    /// name two answers and neither names none, and a judge cannot choose between them.
    ///
    /// # Errors
    ///
    /// [`TaskError::OutputSource`] when both are given or neither is.
    pub fn of(path: Option<PathBuf>, digest: Option<FileDigest>) -> Result<Self, TaskError> {
        match (path, digest) {
            (Some(path), None) => Ok(Self::Path(path)),
            (None, Some(digest)) => Ok(Self::Digest(digest)),
            (Some(_), Some(_)) | (None, None) => Err(TaskError::OutputSource),
        }
    }
}

impl Judgement {
    /// An answer that was never written: a wrong answer, not a failed check, said in the
    /// sentence that names the file the parameters asked for.
    fn unwritten(filename: &str) -> Self {
        Self {
            success: true,
            outcome: Some(0.0),
            text: EVALUATION_MESSAGES
                .get("nooutput")
                .message()
                .reported_naming(filename),
            admin_text: None,
            sandboxes: Vec::new(),
        }
    }

    /// A check that could not be made: a checker the dataset does not hold, a box that
    /// would not take its files, or a run whose ending says nothing about the answer.
    fn unchecked() -> Self {
        Self {
            success: false,
            outcome: None,
            text: Vec::new(),
            admin_text: None,
            sandboxes: Vec::new(),
        }
    }

    /// What a checker decided, or nothing where it could not decide, with the boxes the
    /// check was made in — named whether or not the check could be completed, since a
    /// box left behind is only findable if the report says where it is.
    fn of(verdict: Option<Verdict>, sandboxes: Vec<PathBuf>) -> Self {
        let Some(verdict) = verdict else {
            return Self {
                sandboxes,
                ..Self::unchecked()
            };
        };
        Self {
            success: true,
            outcome: Some(verdict.outcome),
            text: verdict.text,
            admin_text: verdict.admin_text,
            sandboxes,
        }
    }
}

/// Judges an answer by a checker the dataset names, or by a white diff where it names
/// none, in the reference's order: whether the file is there comes before who checks it.
///
/// # Errors
///
/// [`TaskError`], and only that: a dataset holding no correct answer, a store that would
/// not hand a file over, and a checker the worker could not stage or launch.
pub fn eval_output(
    job: &EvaluationJob,
    checker: Option<&str>,
    answer: OutputSource,
    filename: &str,
    extra_args: &[String],
    runtime: &Runtime,
    store: Arc<dyn Cache>,
) -> Result<Judgement, TaskError> {
    if let OutputSource::Path(path) = &answer {
        if !is_answer(path) {
            return Ok(Judgement::unwritten(filename));
        }
    }
    match checker {
        Some(codename) => check_with(job, codename, answer, extra_args, runtime, store),
        None => compare_with_correct(job, &answer, store),
    }
}

/// Runs the checker the dataset names, in a box of its own, over the answer copied in.
///
/// The sandbox path is returned whether or not it is removed, because a report names
/// every box a job made, and one left behind is named for whoever reads it.
fn check_with(
    job: &EvaluationJob,
    codename: &str,
    answer: OutputSource,
    extra_args: &[String],
    runtime: &Runtime,
    store: Arc<dyn Cache>,
) -> Result<Judgement, TaskError> {
    let Some(digest) = job.managers.get(codename) else {
        return Ok(Judgement::unchecked());
    };
    let mut run = runtime.open_shared(CHECK_BOX, store)?;
    stage_answer(run.files(), &answer)?;
    let check = Check {
        checker: Some(handle(digest)?),
        input: handle(&job.input)?,
        correct_output: correct_handle(job)?,
        output_filename: USER_OUTPUT_FILENAME,
        extra_args,
        limits: runtime.trusted,
    };
    let (sandbox, files) = run.parts();
    let verdict = checker_step(sandbox, files, &check)?;
    let root = run.close(job.archive_sandbox || verdict.is_none())?;
    Ok(Judgement::of(verdict, vec![root]))
}

/// Compares the answer with the dataset's own, byte for byte once whitespace is folded,
/// and awards the whole score or none of it.
fn compare_with_correct(
    job: &EvaluationJob,
    answer: &OutputSource,
    store: Arc<dyn Cache>,
) -> Result<Judgement, TaskError> {
    let correct = store.get_file(&correct_handle(job)?)?;
    let written = match answer {
        OutputSource::Path(path) => {
            fs::read(path).map_err(|source| TaskError::Stage(StageError::io(path, &source)))?
        }
        OutputSource::Digest(digest) => store.get_file(&CacheHandle::new(digest.clone()))?,
    };
    let comparison = Comparison::of(white_diff(&written, &correct));
    Ok(Judgement {
        success: true,
        outcome: Some(comparison.outcome),
        text: comparison.text,
        admin_text: None,
        sandboxes: Vec::new(),
    })
}

/// Copies the answer into the check box, from where it is: a file the run wrote is read
/// here, and one the submission carried is fetched from the store by a box of its own.
fn stage_answer(files: &Stage, answer: &OutputSource) -> Result<(), TaskError> {
    match answer {
        OutputSource::Path(path) => {
            let content =
                fs::read(path).map_err(|source| TaskError::Stage(StageError::io(path, &source)))?;
            files.write(USER_OUTPUT_FILENAME, &content, false)?;
        }
        OutputSource::Digest(digest) => files.write_from_storage(
            USER_OUTPUT_FILENAME,
            &CacheHandle::new(digest.clone()),
            false,
        )?,
    }
    Ok(())
}

/// The handle for the answer the dataset says is right, which a job judging an answer at
/// all always carries; one that does not is a job built wrong rather than an answer.
fn correct_handle(job: &EvaluationJob) -> Result<CacheHandle, TaskError> {
    job.output
        .as_deref()
        .map(handle)
        .transpose()?
        .ok_or(TaskError::NoCorrectOutput)
}

/// Whether a path names a file a judge may read. A link is no file at all, which is the
/// reference's rule and the reason it is stated here rather than after the read: a
/// symlink to an existing file would otherwise pass every check it is given.
fn is_answer(path: &Path) -> bool {
    let linked = fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink());
    path.exists() && !linked
}
