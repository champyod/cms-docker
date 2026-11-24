#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cms_db::FileDigest;
use cms_proto::DigestMap;

use super::TaskError;
use super::{handle, Closed, Runtime};
use crate::job::EvaluationJob;
use crate::messages::EVALUATION_MESSAGES;
use crate::stage::{Cache, CacheHandle, Stage, StageError};
use crate::steps::{checker_step, white_diff, Check, Comparison, Verdict};

/// The codename a dataset files the checker the parameters asked for under.
pub const CHECKER_CODENAME: &str = "checker";
/// The name of the box a check is made in, which the report names it by.
const CHECK_BOX: &str = "check";
const USER_OUTPUT_FILENAME: &str = "user_output.txt";

/// What a judge decided about one answer.
#[derive(Debug, Clone, PartialEq)]
pub struct Judgement {
    /// Separates an undecidable check from a wrong answer worth zero.
    pub success: bool,
    /// The score the answer earned, absent when it could not be judged.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the checker wrote none.
    pub admin_text: Option<String>,
    /// The boxes a check was made in, which the report names.
    pub sandboxes: Vec<PathBuf>,
    /// The archive digest of each box that was archived, keyed by its path.
    pub sandbox_digests: DigestMap,
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
    /// Refuses ambiguous answers rather than choosing one of two sources.
    pub fn of(path: Option<PathBuf>, digest: Option<FileDigest>) -> Result<Self, TaskError> {
        match (path, digest) {
            (Some(path), None) => Ok(Self::Path(path)),
            (None, Some(digest)) => Ok(Self::Digest(digest)),
            (Some(_), Some(_)) | (None, None) => Err(TaskError::OutputSource),
        }
    }
}

impl Judgement {
    fn unwritten(filename: &str) -> Self {
        let sentence = EVALUATION_MESSAGES.get("nooutput").message();
        Self {
            success: true,
            outcome: Some(0.0),
            text: sentence.reported_naming(filename),
            admin_text: None,
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
        }
    }

    fn unchecked() -> Self {
        Self {
            success: false,
            outcome: None,
            text: Vec::new(),
            admin_text: None,
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
        }
    }

    fn of(verdict: Option<Verdict>, closed: Closed) -> Self {
        let mut judgement = match verdict {
            Some(verdict) => Self {
                success: true,
                outcome: Some(verdict.outcome),
                text: verdict.text,
                admin_text: verdict.admin_text,
                sandboxes: Vec::new(),
                sandbox_digests: DigestMap::new(),
            },
            None => Self::unchecked(),
        };
        closed.record(&mut judgement.sandboxes, &mut judgement.sandbox_digests);
        judgement
    }
}

/// Checks answer existence before selecting a checker so a missing file stays a wrong answer.
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
    let closed = run.close(
        job.archive_sandbox || verdict.is_none(),
        job.archive_sandbox,
    )?;
    Ok(Judgement::of(verdict, closed))
}

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
        sandbox_digests: DigestMap::new(),
    })
}

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

fn correct_handle(job: &EvaluationJob) -> Result<CacheHandle, TaskError> {
    job.output
        .as_deref()
        .map(handle)
        .transpose()?
        .ok_or(TaskError::NoCorrectOutput)
}

fn is_answer(path: &Path) -> bool {
    let linked = fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink());
    path.exists() && !linked
}
