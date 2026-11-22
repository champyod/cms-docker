//! The records and the language the two compile-phase tests are decided by.
//!
//! Nothing here needs a toolchain installed: a language answers with one command
//! that carries the sources it was handed, in the order it was handed them, and the
//! isolation program is the stub beside this file that records the command and
//! leaves behind the file a compilation is expected to produce. A test then reads
//! the command and the box back, which is what makes an order visible.

#![allow(dead_code)]

#[path = "tasktypes_helpers.rs"]
mod base;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use cms_grading::job::{CompilationJob, Dataset, Submission};
use cms_grading::tasktypes::Toolchain;
use cms_proto::{DigestMap, Operation, OperationKind};
use serde_json::Value;

pub use base::{
    content_of, digests, flags_of, produced, runtime_of, staged, store_of, workspace, CLEAN_LOG,
    FAILED_LOG, GRADER_DIGEST, HEADER_DIGEST, INPUT_DIGEST, NOTHING, PROGRAM_DIGEST, SOURCE_DIGEST,
};

/// The log an isolation program that could not run the command leaves, so the box
/// is what failed and no compilation started inside it.
pub const SANDBOX_ERROR_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\nstatus:XX\nexitcode:1\n";

/// The names a job is addressed by, which every record here is the same one of.
const OBJECT: i64 = 7;
const DATASET: i64 = 3;

/// A language whose extensions a test chooses, answering with one command that
/// carries the sources in the order the task type chose for them.
pub struct Language {
    source: &'static [&'static str],
    header: &'static [&'static str],
    executable: &'static str,
}

pub const CPP: Language = Language {
    source: &[".cpp"],
    header: &[".h"],
    executable: "",
};

/// A language that names its executables with an extension, as C# and Java do.
pub const CSHARP: Language = Language {
    source: &[".cs"],
    header: &[],
    executable: ".exe",
};

/// A language with no headers at all, as Python and Java have none.
pub const PYTHON: Language = Language {
    source: &[".py"],
    header: &[],
    executable: "",
};

impl Toolchain for Language {
    fn name(&self) -> &str {
        "Stub"
    }

    fn source_extensions(&self) -> &[&str] {
        self.source
    }

    fn header_extensions(&self) -> &[&str] {
        self.header
    }

    fn executable_extension(&self) -> &str {
        self.executable
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        vec![vec![format!("compile {executable}"), sources.join(" ")]]
    }
}

/// A compilation of `files` against a dataset holding `managers`, with the task
/// type parameters a test chose and an operation that archives its box or not.
pub fn job_of(
    files: DigestMap,
    parameters: Value,
    managers: DigestMap,
    archive_sandbox: bool,
) -> CompilationJob {
    let operation = Operation {
        kind: OperationKind::Compilation,
        object_id: OBJECT,
        dataset_id: DATASET,
        testcase_codename: None,
        archive_sandbox,
    };
    let submission = Submission {
        id: OBJECT,
        language: Some("Stub".to_owned()),
        language_descriptor: None,
        files,
        result_executables: DigestMap::new(),
        multithreaded_sandbox: false,
    };
    let dataset = Dataset {
        id: DATASET,
        task_type: "test".to_owned(),
        task_type_parameters: parameters,
        managers,
        auto_managers: None,
        testcases: BTreeMap::new(),
        time_limit: Some(5.0),
        memory_limit: Some(1024 * 1024),
    };
    CompilationJob::from_submission(&operation, &submission, &dataset)
        .expect("a compilation operation builds a job")
}

/// The words a run was launched with: what the stub recorded after its own `--`.
pub fn words_of(box_of: &Path) -> Vec<String> {
    let recorded = flags_of(box_of);
    let words: Vec<String> = recorded.lines().map(str::to_owned).collect();
    match words.iter().position(|word| word == "--") {
        Some(after) => words[after + 1..].to_vec(),
        None => words,
    }
}

/// The names a box was handed, which is what it holds less the files the stub wrote
/// as the compilation's own output.
pub fn handed(box_of: &Path, written: &[&str]) -> Vec<String> {
    staged(box_of)
        .into_iter()
        .filter(|name| !written.contains(&name.as_str()))
        .collect()
}

/// Whether any box was made under `dir`, which a refusal must not have done.
pub fn box_made(dir: &Path) -> bool {
    fs::read_dir(dir)
        .expect("the test's directory to be readable")
        .map(|entry| {
            entry
                .expect("a directory entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .any(|name| name.starts_with("cms-sandbox-"))
}
