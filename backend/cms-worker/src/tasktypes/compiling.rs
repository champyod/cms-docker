//! One compilation in one box, as every task type that builds a program does it:
//! the files it is handed, the commands that turn them into an executable, the
//! executable itself, and what each of those commands printed.
//!
//! Which files are handed over and what the executable is called is the task
//! type's own decision and arrives as [`Inputs`] and a name. Everything from the
//! box on is the same for all of them, so it happens here once: a second copy is
//! how a box's success and a compilation's success drift apart.
//!
//! A box that did not work is not a compilation that failed, so it comes back
//! undecided, and an executable is stored only where the compilation produced one.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::measure::ExitStatus;
use crate::sandbox::{MappedDirectory, Options, Sandbox};
use crate::stage::Cache;
use crate::stats::ExecutionStats;

use super::batch::SOURCE_PLACEHOLDER;
use super::{handle, wall_clock_of, Run, Runtime, TaskError, Toolchain};

/// The name the box a compilation runs in is made under, which is also what the
/// report names its sandbox by.
pub(super) const COMPILE_BOX: &str = "compile";
/// The prefix a command's standard output is written under, numbered so two never collide.
const OUTPUT_PREFIX: &str = "compilation_stdout_";
const ERROR_PREFIX: &str = "compilation_stderr_";
const STREAM_EXTENSION: &str = ".txt";
/// The system configuration directory, which the toolchains read.
const SYSTEM_CONFIG: &str = "/etc";
/// The package database a Haskell compiler reads, mapped where the machine holds one.
const TOOLCHAIN_PACKAGES: &str = "/var/lib/ghc";
const SUCCEEDED: &str = "Compilation succeeded";
const FAILED: &str = "Compilation failed";
const TIMED_OUT: &str = "Compilation timed out";
const KILLED: &str = "Compilation killed with signal";

/// What a compilation left behind, as the result is filed.
#[derive(Debug, Clone, PartialEq)]
pub struct Compilation {
    /// The paths the report names this compilation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// Whether the box worked, so what the run reported can be believed.
    pub success: bool,
    /// Whether the compilation produced an executable, `None` when the box did
    /// not work and there is nothing to say either way.
    pub compilation_success: Option<bool>,
    /// The sentence a report shows, empty when there is nothing to show.
    pub text: Vec<String>,
    /// What the compilation was charged, absent when no run was measured.
    pub stats: Option<ExecutionStats>,
    /// The files the report stores, by name, as digests.
    pub executables: DigestMap,
    /// What every command printed, by the name of the stream file it was
    /// redirected to, as digests, so a warning outlives the box that held it.
    pub diagnostics: DigestMap,
}

/// The sources the compiler is given, and every file the box is handed.
pub(super) struct Inputs {
    pub(super) sources: Vec<String>,
    pub(super) files: DigestMap,
}

/// The executable a set of codenames compiles to: their names without the
/// placeholder, sorted and joined, then the language's extension.
///
/// Sorting is what makes the name deterministic whatever order the files arrived
/// in, and the placeholder is dropped because the name is the one an evaluation
/// looks for rather than a source of any language.
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

/// Runs one compilation: the box is made and handed every file, its commands are
/// run in order, and what they left is filed.
///
/// # Errors
///
/// [`TaskError`], and only that: a file the store would not hand over, a stream
/// file it would not keep, and a run the box could not carry.
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
    compilation.sandboxes.push(run.close(keep)?);
    Ok(compilation)
}

/// Runs the compilation commands in the box, stopping at the first that did not
/// end cleanly, filing what each printed and answering with what all cost.
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

/// The options one compilation command is launched under: the two directories a
/// compilation needs to see, the three limits the operator set, and that
/// command's own two stream files, over the options the box carries.
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

/// The two streams one command was redirected to, filed in the store under the
/// names the run was given them by, and a stream it never wrote left out.
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
        None => (false, None, Vec::new()),
        Some(stats) => match stats.exit_status {
            ExitStatus::Ok => (true, Some(true), said(SUCCEEDED)),
            ExitStatus::NonzeroReturn => (true, Some(false), said(FAILED)),
            ExitStatus::Timeout | ExitStatus::TimeoutWall => (true, Some(false), said(TIMED_OUT)),
            ExitStatus::Signal => (true, Some(false), said(&killed_by(stats.signal))),
            ExitStatus::SandboxError | ExitStatus::MemoryLimit => (false, None, Vec::new()),
        },
    };
    Compilation {
        sandboxes: Vec::new(),
        success,
        compilation_success,
        text,
        stats: if success { stats.cloned() } else { None },
        executables: DigestMap::new(),
        diagnostics: DigestMap::new(),
    }
}

/// The one sentence a report shows, as the list a report holds its sentences in.
fn said(message: &str) -> Vec<String> {
    vec![message.to_owned()]
}

/// The sentence for a compilation a signal killed, with no number where it had none.
fn killed_by(signal: Option<i64>) -> String {
    signal.map_or_else(|| KILLED.to_owned(), |number| format!("{KILLED} {number}"))
}
