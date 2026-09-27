//! The records, the stub language and the stub isolation program the
//! Communication tests are decided by.
//!
//! Nothing here needs an isolation program installed, and nothing here is what is
//! being tested: the dataset is a Communication one, the language answers with the
//! commands and the arguments a test needs to see, and the isolation program is a
//! stub that behaves as the manager or as a process according to which of them it
//! was handed.
//!
//! The stub does not answer until every run of the evaluation has begun, and
//! records every start and end to one file. That is what a manager and a process
//! waiting at each other's pipes do, and it is how the order the runs are started in
//! is seen: a worker that started one run and waited for it before starting the
//! next would never get past the first, and the record would show one start where
//! three were expected.

#![allow(dead_code)]

#[path = "tasktypes_helpers.rs"]
mod toolchain;

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use cms_proto::{DigestMap, Operation, OperationKind};
use cms_worker::job::{Dataset, EvaluationJob, Submission, Testcase};
use cms_worker::stage::FsCache;
use cms_worker::tasktypes::{CompilationLimits, Runtime};

pub use toolchain::{
    digests, store_of, workspace, StubToolchain, EXECUTABLE, INPUT_DIGEST, PROGRAM_DIGEST, SOURCE,
    SOURCE_DIGEST,
};

/// The manager the dataset holds, and the ids the records are addressed by.
pub const MANAGER: &str = "manager";
const MANAGER_DIGEST: &str = "9d75cc3f9e956e155e6bc7e4c5662c1a46b20a0e";
const OBJECT: i64 = 7;
const DATASET: i64 = 3;
const TESTCASE: &str = "1.in";
/// The runs one evaluation of a two-process task starts: the manager and both.
pub const THREE: usize = 3;
/// What a manager prints: the score, the sentence for a contestant, the line for
/// the administrators, and the file a user test is shown.
pub const SCORE: &str = "42.5";
pub const SAID: &str = "wrong answer";
pub const ADMIN: &str = "read the input twice";
/// The log a run that measured nothing of its own leaves behind.
const CLEAN_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\n";
/// The runtime whose runs are launched under a stub answering as the manager or as
/// a process, and which answers nothing until `starts` runs have begun.
///
/// `user_time` is the CPU time each process is charged, which is what the merge and
/// the total against the limit are read from.
pub fn runtime_of(dir: &Path, user_time: &str, starts: usize) -> Runtime {
    let record = dir.join("record.txt");
    let stub = dir.join("isolate");
    fs::write(
        &stub,
        format!(
            "#!/bin/sh\n\
             meta=\nhome=\n\
             for arg in \"$@\"; do\n\
             \x20 case \"$arg\" in\n\
             \x20\x20--meta=*) meta=\"${{arg#--meta=}}\" ;;\n\
             \x20\x20--dir=/tmp=*) home=\"${{arg#--dir=/tmp=}}\"; home=\"${{home%%:*}}\" ;;\n\
             \x20 esac\n\
             done\n\
             printf '%s\\n' \"$@\" > \"$home/flags.txt\"\n\
             printf 'start %s\\n' \"$home\" >> '{record}'\n\
             waiting=0\n\
             while [ \"$(grep -c '^start ' '{record}')\" -lt {STARTS} ]; do\n\
             \x20 waiting=$((waiting + 1))\n\
             \x20 if [ \"$waiting\" -gt 100 ]; then break; fi\n\
             \x20 sleep 0.02\n\
             done\n\
             if [ -f \"$home/{MANAGER}\" ]; then\n\
             \x20 printf '{SCORE}\\n'\n\
             \x20 printf '{SAID}\\n' >&2\n\
             \x20 printf 'ADMIN_MESSAGE: {ADMIN}\\n' >&2\n\
             \x20 printf 'the note' > \"$home/output.txt\"\n\
             \x20 printf '{CLEAN_LOG}' > \"$meta\"\n\
             else\n\
             \x20 printf 'time:{user_time}\\ntime-wall:1.5\\ncg-mem:2048\\n' > \"$meta\"\n\
             fi\n\
             printf 'end %s\\n' \"$home\" >> '{record}'\n\
             exit 0\n",
            record = record.display(),
            STARTS = starts,
        ),
    )
    .expect("the stub must be writable");
    fs::set_permissions(&stub, fs::Permissions::from_mode(0o755)).expect("the stub must run");
    let limits = CompilationLimits {
        time: Some(Duration::from_secs(30)),
        memory: Some(64 * 1024 * 1024),
        processes: Some(4),
    };
    Runtime::new(stub, dir, limits, Some(2048 * 1024))
}

/// The record of every run's start and end, in the order they happened.
pub fn order_of(dir: &Path) -> Vec<String> {
    fs::read_to_string(dir.join("record.txt"))
        .expect("the stub must have recorded the order")
        .lines()
        .map(str::to_owned)
        .collect()
}

/// The dataset a Communication job is built against, with the manager among its
/// managers and the one testcase the operation names.
pub fn dataset() -> Dataset {
    let mut managers: DigestMap = digests(&[("README", INPUT_DIGEST)]);
    managers.insert(MANAGER.to_owned(), MANAGER_DIGEST.to_owned());
    let mut testcases = BTreeMap::new();
    testcases.insert(
        TESTCASE.to_owned(),
        Testcase {
            codename: TESTCASE.to_owned(),
            input: INPUT_DIGEST.to_owned(),
            output: SOURCE_DIGEST.to_owned(),
        },
    );
    Dataset {
        id: DATASET,
        task_type: "communication".to_owned(),
        task_type_parameters: serde_json::json!([2, "stub", "fifo_io"]),
        managers,
        auto_managers: None,
        testcases,
        time_limit: Some(5.0),
        memory_limit: Some(1024 * 1024),
    }
}

/// The evaluation of one submission on the one testcase, with the executable the
/// result holds and the manager the dataset holds.
pub fn job() -> EvaluationJob {
    let operation = Operation {
        kind: OperationKind::Evaluation,
        object_id: OBJECT,
        dataset_id: DATASET,
        testcase_codename: Some(TESTCASE.to_owned()),
        archive_sandbox: true,
    };
    let submission = Submission {
        id: OBJECT,
        language: None,
        language_descriptor: None,
        files: digests(&[(SOURCE, SOURCE_DIGEST)]),
        result_executables: digests(&[(EXECUTABLE, PROGRAM_DIGEST)]),
        multithreaded_sandbox: true,
    };
    EvaluationJob::from_submission(&operation, &submission, &dataset())
        .expect("an evaluation naming a testcase the dataset holds builds a job")
}

/// The flags and the words of a run, read out of the box it was launched in.
pub fn flags_of(box_of: &Path) -> String {
    fs::read_to_string(box_of.join("home").join("flags.txt")).expect("the stub recorded them")
}

/// The words a run was launched with, which are the last of what the stub recorded.
pub fn words_of(box_of: &Path) -> Vec<String> {
    let recorded = flags_of(box_of);
    let words: Vec<String> = recorded.lines().map(str::to_owned).collect();
    match words.iter().position(|word| word == "--") {
        Some(after) => words[after + 1..].to_vec(),
        None => words,
    }
}

/// The content the store holds for a digest a report names.
pub fn content_of(store: &FsCache, digest: &str) -> Vec<u8> {
    toolchain::content_of(store, digest)
}
