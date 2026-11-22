//! The files, the records and the stub the judge's tests are decided by.
//!
//! Every answer is a file this module wrote and a store the Batch tests already hold, so
//! a judgement is made from bytes rather than from a machine. The one program is a stub
//! standing in for the isolation program, printing the verdict a test chose.

#![allow(dead_code, unused_imports)]

#[path = "tasktypes_helpers.rs"]
pub mod fixtures;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use cms_grading::job::EvaluationJob;
use cms_grading::stage::Cache;
use cms_grading::tasktypes::{eval_output, Judgement, OutputSource, TaskError};
use cms_proto::DigestMap;

pub use fixtures::{
    runtime_of, staged, store_of, workspace, CLEAN_LOG, GRADER_DIGEST, NOTHING, SOURCE_DIGEST,
};

/// The codename a dataset files its checker under.
pub const CHECKER: &str = "checker";
/// The filename a report quotes for an answer the run never wrote.
pub const ANSWER_FILENAME: &str = "answer.txt";
/// A digest no store holds.
pub const ABSENT: &str = "1111111111111111111111111111111111111111";
/// What a checker that answered with a score printed, and what one that answered with
/// no score printed.
pub const SCORED: &str = "printf '0.5\\n'; printf 'Output is partially correct\\n' >&2";
pub const UNSCORED: &str = "printf 'not a number\\n'";

/// The store the Batch tests hold, over a directory of the test's own.
pub fn store(dir: &Path) -> Arc<dyn Cache> {
    Arc::new(store_of(dir))
}

/// The answer a test wrote, under the directory the store is beside.
pub fn written(dir: &Path, content: &[u8]) -> PathBuf {
    let path = dir.join(ANSWER_FILENAME);
    fs::write(&path, content).expect("the answer must be writable");
    path
}

/// Whether the box a check is made in was ever created under `dir`.
pub fn check_box_made(dir: &Path) -> bool {
    dir.join("cms-sandbox-check").exists()
}

/// A job on the dataset the fixtures hold, with a checker filed under the codename when
/// a test asks for one.
pub fn job(checker: bool) -> EvaluationJob {
    let mut job = fixtures::evaluate_job(DigestMap::new());
    if checker {
        job.managers
            .insert(CHECKER.to_owned(), GRADER_DIGEST.to_owned());
    }
    job
}

/// Judges one answer, under a stub that prints `said` as a checker's verdict.
pub fn judged(
    dir: &Path,
    job: &EvaluationJob,
    checker: Option<&str>,
    answer: OutputSource,
    said: &str,
) -> Result<Judgement, TaskError> {
    eval_output(
        job,
        checker,
        answer,
        ANSWER_FILENAME,
        &[],
        &runtime_of(dir, "0", CLEAN_LOG, said),
        store(dir),
    )
}

/// The judgement of the answer a test wrote, by a white diff, which no stub takes part in.
pub fn diffed(dir: &Path, content: &[u8]) -> Judgement {
    judged(
        dir,
        &job(false),
        None,
        OutputSource::Path(written(dir, content)),
        NOTHING,
    )
    .expect("a file the run wrote is judged")
}
