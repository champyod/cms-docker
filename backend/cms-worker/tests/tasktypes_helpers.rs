//! The records, the stub language and the stub isolation program the Batch tests
//! are decided by.
//!
//! Nothing here needs an isolation program installed, and nothing here is what is
//! being tested: a language answers with the commands a test chose, and a run is
//! launched under a stub executable the test wrote, which records the arguments
//! it was given, writes the files a run was supposed to leave behind, writes the
//! log a real one would write and returns the code the test chose.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use cms_proto::{DigestMap, Operation, OperationKind};
use cms_worker::job::{CompilationJob, Dataset, EvaluationJob, Submission, Testcase};
use cms_worker::stage::{Cache, CacheHandle, FileDigest, FsCache};
use cms_worker::tasktypes::{CompilationLimits, Runtime, Toolchain};

/// The names a job is addressed by, which every record here is the same one of.
const OBJECT: i64 = 7;
const DATASET: i64 = 3;
const TESTCASE: &str = "1.in";
/// The codename a source is submitted under, and the executable it compiles to.
pub const SOURCE: &str = "sol.%l";
pub const EXECUTABLE: &str = "sol";
pub const GRADER: &str = "grader.cpp";
pub const HEADER: &str = "grader.h";
pub const SOURCE_DIGEST: &str = "c1e1753cc8d44bf53738fef25cfeda1a63cd99cf";
pub const GRADER_DIGEST: &str = "b29f82c964ef13ed684bcac8fd4ce3cc0619f8b2";
pub const HEADER_DIGEST: &str = "a77cd8c58199899bdaebaca44fc12b514f9278d6";
pub const PROGRAM_DIGEST: &str = "9d75cc3f9e956e155e6bc7e4c5662c1a46b20a0e";
pub const INPUT_DIGEST: &str = "b6ebcfbbe02eae2dcf3adb88f28c273eac955f78";
pub const CLEAN_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\n";
pub const FAILED_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\nstatus:RE\nexitcode:1\n";
pub const STOPPED_LOG: &str = "time:5\ntime-wall:5\ncg-mem:2048\nstatus:TO\nexitcode:0\n";
/// What a run expected to have answered nothing leaves behind.
pub const NOTHING: &str = ":";
/// A language that answers with the commands a test chose.
pub struct StubToolchain;

impl Toolchain for StubToolchain {
    fn source_extension(&self) -> &str {
        ".cpp"
    }

    fn executable_extension(&self) -> &str {
        ""
    }

    fn compiles_against(&self, manager: &str) -> bool {
        manager.ends_with(".cpp") || manager.ends_with(".h")
    }

    fn compilation_commands(&self, sources: &[String], executable: &str) -> Vec<Vec<String>> {
        vec![vec![format!("compile {executable}"), sources.join(" ")]]
    }

    fn evaluation_commands(&self, executable: &str, main: &str) -> Vec<Vec<String>> {
        vec![vec![format!("run {executable}"), main.to_owned()]]
    }
}

pub fn digests(pairs: &[(&str, &str)]) -> DigestMap {
    pairs
        .iter()
        .map(|(name, digest)| ((*name).to_owned(), (*digest).to_owned()))
        .collect()
}

fn operation(kind: OperationKind) -> Operation {
    Operation {
        kind,
        object_id: OBJECT,
        dataset_id: DATASET,
        testcase_codename: None,
        archive_sandbox: true,
    }
}

pub fn dataset(managers: DigestMap) -> Dataset {
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
        task_type: "batch".to_owned(),
        task_type_parameters: serde_json::json!(["alone", ["", ""], "diff"]),
        managers,
        auto_managers: None,
        testcases,
        time_limit: Some(5.0),
        memory_limit: Some(1024 * 1024),
    }
}

pub fn submission(executables: DigestMap) -> Submission {
    Submission {
        id: OBJECT,
        language: None,
        language_descriptor: None,
        files: digests(&[(SOURCE, SOURCE_DIGEST)]),
        result_executables: executables,
        multithreaded_sandbox: true,
    }
}

pub fn managers() -> DigestMap {
    digests(&[
        (GRADER, GRADER_DIGEST),
        (HEADER, HEADER_DIGEST),
        ("README", INPUT_DIGEST),
    ])
}

pub fn compile_job(managers: DigestMap) -> CompilationJob {
    compilation_of(&submission(DigestMap::new()), &dataset(managers))
}

/// A compilation of one submission against one dataset, which is the record a
/// compilation's refusals are made from.
pub fn compilation_of(submission: &Submission, dataset: &Dataset) -> CompilationJob {
    CompilationJob::from_submission(&operation(OperationKind::Compilation), submission, dataset)
        .expect("a compilation operation builds a job")
}

pub fn evaluate_job(executables: DigestMap) -> EvaluationJob {
    let mut operation = operation(OperationKind::Evaluation);
    operation.testcase_codename = Some(TESTCASE.to_owned());
    EvaluationJob::from_submission(&operation, &submission(executables), &dataset(managers()))
        .expect("an evaluation naming a testcase the dataset holds builds a job")
}

/// A directory of this test's own, named after the test so parallel tests differ.
pub fn workspace(test: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(test);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("the test's own directory must be creatable");
    dir
}

/// A store holding every file a job above names, over a directory of its own.
pub fn store_of(dir: &Path) -> FsCache {
    let held: [(&str, &[u8]); 5] = [
        (SOURCE_DIGEST, b"the source"),
        (GRADER_DIGEST, b"the grader"),
        (HEADER_DIGEST, b"the header"),
        (PROGRAM_DIGEST, b"the program"),
        (INPUT_DIGEST, b"the input"),
    ];
    let store = FsCache::at(dir.join("store")).expect("a store directory");
    for (digest, content) in held {
        let digest = FileDigest::from_str(digest).expect("a digest the domain admits");
        store.put_file(&digest, content).expect("content stored");
    }
    store
}

/// A stub standing in for the isolation program: it records the arguments it was
/// given, writes the files a run was supposed to leave behind, writes the log it
/// was told to write, and returns the code it was told to.
fn isolation_stub(dir: &Path, code: &str, log: &str, leaves: &str) -> PathBuf {
    let path = dir.join("isolate");
    let mut file = fs::File::create(&path).expect("the stub must be creatable");
    file.write_all(
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
             {leaves}\n\
             printf '{log}' > \"$meta\"\n\
             exit {code}\n"
        )
        .as_bytes(),
    )
    .expect("the stub must be writable");
    file.sync_all()
        .expect("the stub must be written to its end");
    drop(file);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("the stub must run");
    path
}

/// A runtime whose runs are launched under a stub leaving `leaves` behind.
pub fn runtime_of(dir: &Path, code: &str, log: &str, leaves: &str) -> Runtime {
    let program = isolation_stub(dir, code, log, leaves);
    let limits = CompilationLimits {
        time: Some(Duration::from_secs(30)),
        memory: Some(64 * 1024 * 1024),
        processes: Some(4),
    };
    Runtime::new(program, dir, limits, Some(2048 * 1024))
}

/// The names of the files a box was handed, in one order however it wrote them.
pub fn staged(box_of: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(box_of.join("home"))
        .expect("a box to have a directory")
        .map(|entry| {
            entry
                .expect("a staged file")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// The arguments a run was launched with, read out of the box it was launched in.
pub fn flags_of(box_of: &Path) -> String {
    fs::read_to_string(box_of.join("home").join("flags.txt")).expect("the stub recorded them")
}

/// The content the store holds for a digest a report names.
pub fn content_of(store: &FsCache, digest: &str) -> Vec<u8> {
    let digest = FileDigest::from_str(digest).expect("a digest the domain admits");
    let handle = CacheHandle::new(digest);
    store.get_file(&handle).expect("held content")
}

/// What a compilation is expected to have left behind: the executable.
pub fn produced(program: &str) -> String {
    format!("printf 'the program' > \"$home/{program}\"\n{NOTHING}")
}

/// What an evaluation is expected to have left behind: the answer.
pub fn answered() -> String {
    format!("printf 'the answer' > \"$home/${{out##*/}}\"\n{NOTHING}")
}
