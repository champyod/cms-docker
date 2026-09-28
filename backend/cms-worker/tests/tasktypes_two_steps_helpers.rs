//! The records, the stub language and the stub isolation program the Two Steps tests
//! are decided by.
//!
//! Nothing here needs an isolation program installed, and nothing here is what is
//! being tested: the dataset is a Two Steps one, the language answers with the
//! commands and the arguments a test needs to see, and the isolation program is a
//! stub that records every start and end.
//!
//! The stub answers nothing until every run of the evaluation has begun, and that is
//! the whole of what makes the order the runs are started in visible: a worker that
//! started one run and waited for it before starting the second would never get past
//! the first, because the two phases talk through one pipe and neither can end before
//! the other has read what it wrote. Only the second phase is told where to write its
//! answer, so the stub leaves that file behind for that run alone, which is how the
//! two phases are told apart and how a run that answered nothing is seen.

#![allow(dead_code, unused_imports)]

#[path = "tasktypes_helpers.rs"]
mod toolchain;

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use cms_proto::{DigestMap, Operation, OperationKind};
use cms_worker::job::{Dataset, EvaluationJob, Submission, Testcase};
use cms_worker::tasktypes::{CompilationLimits, Runtime};

pub use toolchain::{
    content_of, digests, store_of, workspace, StubToolchain, INPUT_DIGEST, PROGRAM_DIGEST,
    SOURCE_DIGEST,
};

/// The manager the result holds, and the ids the records are addressed by.
pub const EXECUTABLE: &str = "manager";
const OBJECT: i64 = 7;
const DATASET: i64 = 3;
const TESTCASE: &str = "1.in";
/// The runs one evaluation of a two-step task starts: one per phase.
pub const TWO: usize = 2;
/// The score of a run that did not answer, and of a job that only asked to be run.
pub const NO_CREDIT: f64 = 0.0;
/// The log a run that measured its own figures of nothing writes.
pub const CLEAN_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\n";
/// The log a run that was stopped by its own limit writes.
pub const STOPPED_LOG: &str = "time:5\ntime-wall:5\ncg-mem:2048\nstatus:TO\nexitcode:0\n";

/// The runtime whose runs are launched under the stub, `log` the log each phase
/// writes, and `answers` whether the second phase leaves its answer behind.
pub fn runtime_of(dir: &Path, log: &str, answers: bool) -> Runtime {
    let record = dir.join("record.txt");
    let stub = dir.join("isolate");
    let write = if answers {
        "printf 'the answer' > \"$home/${out##*/}\"\n"
    } else {
        ""
    };
    fs::write(
        &stub,
        format!(
            "#!/bin/sh\n\
             meta=\nhome=\nout=\n\
             for arg in \"$@\"; do\n\
             \x20 case \"$arg\" in\n\
             \x20\x20--meta=*) meta=\"${{arg#--meta=}}\" ;;\n\
             \x20\x20--dir=/tmp=*) home=\"${{arg#--dir=/tmp=}}\"; home=\"${{home%%:*}}\" ;;\n\
             \x20\x20--stdout=*) out=\"${{arg#--stdout=}}\" ;;\n\
             \x20 esac\n\
             done\n\
             printf '%s\\n' \"$@\" > \"$home/flags.txt\"\n\
             printf 'start %s\\n' \"$home\" >> '{record}'\n\
             waiting=0\n\
             while [ \"$(grep -c '^start ' '{record}')\" -lt {TWO} ]; do\n\
             \x20 waiting=$((waiting + 1))\n\
             \x20 if [ \"$waiting\" -gt 200 ]; then break; fi\n\
             \x20 sleep 0.02\n\
             done\n\
             {write}\
             printf '{log}' > \"$meta\"\n\
             printf 'end %s\\n' \"$home\" >> '{record}'\n\
             exit 0\n",
            record = record.display(),
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

/// The flags a run was held to, read out of the box it was launched in.
pub fn flags_of(box_of: &Path) -> String {
    fs::read_to_string(box_of.join("home").join("flags.txt")).expect("the stub recorded them")
}

/// The evaluation of one submission on the one testcase, holding the manager.
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
        files: digests(&[("a.%l", SOURCE_DIGEST)]),
        result_executables: digests(&[(EXECUTABLE, PROGRAM_DIGEST)]),
        multithreaded_sandbox: true,
    };
    let testcase = Testcase {
        codename: TESTCASE.to_owned(),
        input: INPUT_DIGEST.to_owned(),
        output: SOURCE_DIGEST.to_owned(),
    };
    let dataset = Dataset {
        id: DATASET,
        task_type: "two_steps".to_owned(),
        task_type_parameters: serde_json::json!(["diff"]),
        managers: DigestMap::new(),
        auto_managers: None,
        testcases: BTreeMap::from([(TESTCASE.to_owned(), testcase)]),
        time_limit: Some(5.0),
        memory_limit: Some(1024 * 1024),
    };
    EvaluationJob::from_submission(&operation, &submission, &dataset)
        .expect("an evaluation naming a testcase the dataset holds builds a job")
}
