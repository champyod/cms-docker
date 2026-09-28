//! The records, the task types and the digests the two kinds of testcase that are
//! answered by a file rather than by a run are decided by.
//!
//! The stub language and the stub isolation program are the Batch helpers, brought in
//! whole, so what is added here is only what the two kinds need on their own: the
//! one-parameter and the four-parameter tasks, a compilation and an evaluation of a
//! submission carrying a chosen set of files, and the digests a carried answer is
//! named by.

#![allow(dead_code)]

#[path = "tasktypes_helpers.rs"]
pub mod toolchain;

use cms_proto::{DigestMap, Operation, OperationKind};
use cms_worker::job::{CompilationJob, EvaluationJob};
use cms_worker::tasktypes::{BatchAndOutput, OutputOnly};
use serde_json::json;

use toolchain::{compilation_of, dataset, digests, managers, submission};

/// The codename every dataset below holds a testcase under, and so the one a job is
/// evaluated on.
pub const TESTCASE: &str = "1.in";
/// The name the answer to that testcase is submitted under, and the name an answer
/// for another testcase is submitted under.
pub const ANSWER: &str = "output_1.in.txt";
pub const OTHER_ANSWER: &str = "output_2.in.txt";
/// A digest a carried answer is stored under.
pub const ANSWER_DIGEST: &str = "3f79bb7b435b05321651daefd374cdc681dc06fa";
/// A digest the `DIGEST` domain does not admit.
pub const UNADMITTED: &str = "not-a-digest";

/// An output-only task whose answers a checker reads.
pub fn output_only() -> OutputOnly {
    OutputOnly::new(&json!(["comparator"])).expect("one parameter is a task")
}

/// A task that mixes both kinds of answer, listing `listed` as output-only.
pub fn mixed(listed: &str) -> BatchAndOutput {
    BatchAndOutput::new(&json!(["alone", ["", ""], "diff", listed]))
        .expect("four parameters are a task")
}

/// One compilation of a submission carrying `files` and nothing else.
pub fn compilation(files: &[(&str, &str)]) -> CompilationJob {
    let tests = dataset(managers());
    let mut object = submission(DigestMap::new());
    object.files = digests(files);
    compilation_of(&object, &tests)
}

/// One evaluation of a submission carrying `files` and holding `executables`, on the
/// testcase the dataset holds under `codename`.
pub fn evaluation(
    codename: &str,
    files: &[(&str, &str)],
    executables: &[(&str, &str)],
) -> EvaluationJob {
    let tests = dataset(managers());
    let mut object = submission(digests(executables));
    object.files = digests(files);
    let operation = Operation {
        kind: OperationKind::Evaluation,
        object_id: object.id,
        dataset_id: tests.id,
        testcase_codename: Some(codename.to_owned()),
        archive_sandbox: true,
    };
    EvaluationJob::from_submission(&operation, &object, &tests).expect("an evaluation job")
}
