//! Running a dataset's checker in a box of its own, and reading what it decided.
//!
//! The checker is a program the dataset holds, handed the input, the correct answer
//! and the submission's own answer, and it is worth what it prints. It runs inside a
//! box for a reason other than trust: a manager with a bug in it, or a configuration
//! naming one that does not exist, must cost a worker a bounded run and nothing more.
//!
//! Two failures are kept apart here because confusing them decides contests. A check
//! that could not be made — the box already holds a file the checker is to be handed,
//! the dataset holds no checker, the run was stopped, or what it printed is no score —
//! is `None`. A checker that ran and printed a score is a verdict, whatever that score
//! is, and zero is a wrong answer rather than a failed check. Collapsing the two fails
//! an honest submission for a configuration mistake.
//!
//! # Errors
//!
//! [`StepError`], and only that: a file the box would not take, and a run the box could
//! not start or read back. Neither is a verdict about a submission.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;

use crate::stage::{CacheHandle, Stage, StageError};
use cms_sandbox::{Sandbox, SpawnError};

use super::{
    checker_command, extract_verdict, judge_trusted_run, TrustedLimits, Verdict, CHECKER_FILENAME,
    CORRECT_OUTPUT_FILENAME, INPUT_FILENAME,
};

/// The three files a checker is handed, the answer it is asked about, the arguments it
/// is given beside them, and the limits it is held to.
pub struct Check<'a> {
    /// The checker to run, or `None` where the dataset holds none: a check that cannot
    /// be made, which is not a wrong answer.
    pub checker: Option<CacheHandle>,
    /// The testcase's input, staged under [`INPUT_FILENAME`].
    pub input: CacheHandle,
    /// The answer the dataset says is right, staged under [`CORRECT_OUTPUT_FILENAME`].
    pub correct_output: CacheHandle,
    /// The name the submission's answer already has in the box.
    pub output_filename: &'a str,
    /// What the task type adds after those three names, such as which kind of testcase
    /// this is.
    pub extra_args: &'a [String],
    /// The numbers a manager rather than a submission is held to.
    pub limits: TrustedLimits,
}

/// Runs one dataset's checker and answers with what it decided, or with nothing where
/// it could not decide.
///
/// The three files are checked for before the checker is copied in, because a file the
/// box already holds is a task type staging one it should not have, and overwriting it
/// would hide the mistake rather than report it.
///
/// # Errors
///
/// [`StepError`] when a file cannot be staged or the run cannot be launched or read
/// back: the worker's own failure, never the submission's.
pub fn checker_step(
    sandbox: &mut Sandbox,
    files: &Stage,
    check: &Check<'_>,
) -> Result<Option<Verdict>, StepError> {
    if already_present(files) {
        return Ok(None);
    }
    let Some(checker) = check.checker.as_ref() else {
        return Ok(None);
    };
    files.write_from_storage(CHECKER_FILENAME, checker, true)?;
    files.write_from_storage(INPUT_FILENAME, &check.input, false)?;
    files.write_from_storage(CORRECT_OUTPUT_FILENAME, &check.correct_output, false)?;
    let command = checker_command(check.output_filename, check.extra_args);
    let words: Vec<&str> = command.iter().map(String::as_str).collect();
    let mut options = sandbox.options().clone();
    check.limits.apply(&mut options);
    sandbox.set_options(options);
    let stats = sandbox.run(&words)?;
    if !judge_trusted_run(stats.exit_status).ran {
        return Ok(None);
    }
    let stdout = stats.stdout.as_deref().unwrap_or_default();
    let stderr = stats.stderr.as_deref().unwrap_or_default();
    Ok(extract_verdict(stdout.as_bytes(), stderr.as_bytes()).ok())
}

/// Whether the box already holds a file a checker is to be handed, which is a task
/// type's programming error rather than a submission's answer.
fn already_present(files: &Stage) -> bool {
    [INPUT_FILENAME, CORRECT_OUTPUT_FILENAME, CHECKER_FILENAME]
        .into_iter()
        .any(|name| files.path(name).exists())
}

/// Why a checker step could not be carried out at all.
#[derive(Debug)]
pub enum StepError {
    /// A file the checker is to be handed could not be staged.
    Stage(StageError),
    /// The checker could not be launched, or its run could not be read back.
    Spawn(SpawnError),
}

impl fmt::Display for StepError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Stage(error) => write!(f, "{error}"),
            Self::Spawn(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for StepError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Stage(error) => Some(error),
            Self::Spawn(error) => Some(error),
        }
    }
}

impl From<StageError> for StepError {
    fn from(error: StageError) -> Self {
        Self::Stage(error)
    }
}

impl From<SpawnError> for StepError {
    fn from(error: SpawnError) -> Self {
        Self::Spawn(error)
    }
}
