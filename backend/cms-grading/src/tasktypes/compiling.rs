#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::messages::COMPILATION_MESSAGES;
use crate::stage::Cache;
use cms_sandbox::ExecutionStats;
use cms_sandbox::ExitStatus;
use cms_sandbox::{MappedDirectory, Options, Sandbox};

use super::batch::SOURCE_PLACEHOLDER;
use super::{handle, wall_clock_of, Run, Runtime, TaskError, Toolchain};

pub(super) const COMPILE_BOX: &str = "compile";
/// The prefix a command's standard output is written under, numbered so two never collide.
const OUTPUT_PREFIX: &str = "compilation_stdout_";
const ERROR_PREFIX: &str = "compilation_stderr_";
const STREAM_EXTENSION: &str = ".txt";
/// The system configuration directory, which the toolchains read.
const SYSTEM_CONFIG: &str = "/etc";
/// The package database a Haskell compiler reads, mapped where the machine holds one.
const TOOLCHAIN_PACKAGES: &str = "/var/lib/ghc";

/// What a compilation left behind, as the result is filed.
#[derive(Debug, Clone, PartialEq)]
pub struct Compilation {
    /// The paths the report names this compilation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// The archive digest of each box that was archived, keyed by its path.
    pub sandbox_digests: DigestMap,
    /// Whether the box worked, so what the run reported can be believed.
    pub success: bool,
    /// Leaves compilation undecided when the box itself failed.
    pub compilation_success: Option<bool>,
    /// The sentences a report shows, absent when no compilation was attempted.
    pub text: Option<Vec<String>>,
    /// What the compilation was charged, absent when no run was measured.
    pub stats: Option<ExecutionStats>,
    /// The files the report stores, by name, as digests.
    pub executables: DigestMap,
    /// Lets compiler warnings outlive the box that printed them.
    pub diagnostics: DigestMap,
}

/// The sources the compiler is given, and every file the box is handed.
pub(super) struct Inputs {
    pub(super) sources: Vec<String>,
    pub(super) files: DigestMap,
}

pub(super) fn executable_name<'a>(
    codenames: impl IntoIterator<Item = &'a String>,
    toolchain: &dyn Toolchain,
) -> String {
    let mut names: Vec<String> = codenames
        .into_iter()
        .map(|codename| codename.replace(SOURCE_PLACEHOLDER, ""))
        .collect();
    names.sort();
    format!("{}{}", names.join("_"), toolchain.executable_extension())
}

pub(super) fn in_a_box(
    job: &CompilationJob,
    runtime: &Runtime,
    store: Box<dyn Cache>,
    inputs: Inputs,
    executable: String,
    commands: Vec<Vec<String>>,
) -> Result<Compilation, TaskError> {
    let mut run = runtime.open(COMPILE_BOX, store)?;
    for (name, digest) in &inputs.files {
        run.files()
            .write_from_storage(name, &handle(digest)?, false)?;
    }
    let mut diagnostics = DigestMap::new();
    let stats = compile_with(&mut run, &commands, runtime, &mut diagnostics)?;
    let mut compilation = decide(stats.as_ref());
    compilation.diagnostics = diagnostics;
    // A box that worked and produced nothing is a failure, not an executable.
    if matches!(compilation.compilation_success, Some(true)) {
        let digest = run.files().store(&executable)?;
        compilation
            .executables
            .insert(executable, digest.as_str().to_owned());
    }
    let keep = job.archive_sandbox || !compilation.success;
    run.close(keep, job.archive_sandbox)?
        .record(&mut compilation.sandboxes, &mut compilation.sandbox_digests);
    Ok(compilation)
}

fn compile_with(
    run: &mut Run,
    commands: &[Vec<String>],
    runtime: &Runtime,
    diagnostics: &mut DigestMap,
) -> Result<Option<ExecutionStats>, TaskError> {
    let mut merged: Option<ExecutionStats> = None;
    for (number, command) in commands.iter().enumerate() {
        let options = command_options(run.sandbox(), runtime, number);
        let stats = run.launch(command, &options)?;
        file_diagnostics(run, number, diagnostics)?;
        let clean = stats.exit_status == ExitStatus::Ok;
        merged = Some(match merged {
            Some(previous) => previous.merged_with(&stats, false),
            None => stats,
        });
        if !clean {
            break;
        }
    }
    Ok(merged)
}

fn command_options(sandbox: &Sandbox, runtime: &Runtime, number: usize) -> Options {
    let limits = &runtime.compilation;
    let mut options = sandbox.options().clone();
    let mut directories = vec![MappedDirectory::new(SYSTEM_CONFIG)];
    if Path::new(TOOLCHAIN_PACKAGES).exists() {
        directories.push(MappedDirectory::new(TOOLCHAIN_PACKAGES));
    }
    options.directories.extend(directories);
    options.full_environment = true;
    options.cpu_time = limits.time;
    options.wall_clock_timeout = limits.time.map(wall_clock_of);
    options.address_space = limits.memory;
    options.max_processes = limits.processes;
    options.stdout_file = Some(PathBuf::from(stream_file(OUTPUT_PREFIX, number)));
    options.stderr_file = Some(PathBuf::from(stream_file(ERROR_PREFIX, number)));
    options
}

/// One of a command's own stream files, named by its prefix and number.
fn stream_file(prefix: &str, number: usize) -> String {
    format!("{prefix}{number}{STREAM_EXTENSION}")
}

fn file_diagnostics(run: &Run, number: usize, into: &mut DigestMap) -> Result<(), TaskError> {
    for prefix in [OUTPUT_PREFIX, ERROR_PREFIX] {
        let name = stream_file(prefix, number);
        if !run.files().path(&name).is_file() {
            continue;
        }
        let digest = run.files().store(&name)?;
        into.insert(name, digest.as_str().to_owned());
    }
    Ok(())
}

/// What a compilation's figures say, and nothing at all where there was no run.
fn decide(stats: Option<&ExecutionStats>) -> Compilation {
    let (success, compilation_success, text) = match stats {
        None => (false, None, None),
        Some(stats) => match stats.exit_status {
            ExitStatus::Ok => (true, Some(true), Some(said("success"))),
            ExitStatus::NonzeroReturn => (true, Some(false), Some(said("fail"))),
            ExitStatus::Timeout | ExitStatus::TimeoutWall => {
                (true, Some(false), Some(said("timeout")))
            }
            ExitStatus::Signal => (true, Some(false), Some(killed_by(stats))),
            ExitStatus::SandboxError | ExitStatus::MemoryLimit => (false, None, None),
        },
    };
    Compilation {
        sandboxes: Vec::new(),
        sandbox_digests: DigestMap::new(),
        success,
        compilation_success,
        text,
        stats: if success { stats.cloned() } else { None },
        executables: DigestMap::new(),
        diagnostics: DigestMap::new(),
    }
}

fn said(shorthand: &str) -> Vec<String> {
    COMPILATION_MESSAGES.get(shorthand).message().reported()
}

fn killed_by(stats: &ExecutionStats) -> Vec<String> {
    COMPILATION_MESSAGES
        .get("signal")
        .message()
        .reported_naming(&stats.signal.unwrap_or_default().to_string())
}
