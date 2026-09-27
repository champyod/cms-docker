//! The compilation phase: the files a submission is handed, the commands that
//! turn them into an executable, and the executable itself.
//!
//! The order is the reference's and nothing here decides anything of its own:
//! the names the compiler is given, the grader first where there is one because
//! some languages need the entry point in that position, then every file the box
//! needs; then the executable's name, built from the codenames the submission
//! carries rather than from the sources, so two submissions of the same program
//! reach the same name whatever the language calls their files; then the box, the
//! files in it, the commands, and what the commands left behind.
//!
//! A box that did not work is not a compilation that failed: nothing a run
//! reported can be believed either way, so the whole thing comes back undecided —
//! no success, no text and no figures — which is what `compilation_step` answers
//! for a sandbox error and for a run killed for want of memory.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::measure::ExitStatus;
use crate::sandbox::{Options, Sandbox};
use crate::stage::Cache;
use crate::stats::ExecutionStats;

use super::batch::{Batch, GRADER_BASENAME, SOURCE_PLACEHOLDER};
use super::{handle, wall_clock_of, Run, Runtime, TaskError, Toolchain};

/// The name the box a compilation is made in is labelled by.
const COMPILE_BOX: &str = "compile";
/// How many files a submission has to carry for a compilation to be attempted.
const FILES_REQUIRED: usize = 1;
/// The prefix a compilation command's standard output is written under, given
/// that command's own number so no two of them write over each other.
const OUTPUT_PREFIX: &str = "compilation_stdout_";
/// The prefix a compilation command's standard error is written under.
const ERROR_PREFIX: &str = "compilation_stderr_";
/// The extension the two stream files above are given.
const STREAM_EXTENSION: &str = ".txt";
/// The sentence a report shows for a compilation that produced an executable.
const SUCCEEDED: &str = "Compilation succeeded";
/// The sentence a report shows for a compilation that did not.
const FAILED: &str = "Compilation failed";
/// The sentence a report shows for a compilation stopped for its CPU time.
const TIMED_OUT: &str = "Compilation timed out";
/// The sentence for a compilation a signal killed, followed by the signal, being
/// the number a report is read for.
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
}

impl Batch {
    /// Compiles one submission, in the order the reference does the work.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: too few submitted files, a dataset with no
    /// grader manager where a grader is compiled, a file the store would not hand
    /// over, and a run the box could not carry or read back.
    pub fn compile(
        &self,
        job: &CompilationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Compilation, TaskError> {
        if job.files.len() < FILES_REQUIRED {
            return Err(TaskError::TooFewFiles {
                found: job.files.len(),
                wanted: FILES_REQUIRED,
            });
        }
        let inputs = self.inputs(job, toolchain)?;
        let executable = self.executable_name(&job.files, toolchain);
        let commands = toolchain.compilation_commands(&inputs.sources, &executable);
        let mut run = runtime.open(COMPILE_BOX, store)?;
        stage_all(&run, &inputs.files)?;
        let stats = compile_with(&mut run, &commands, runtime)?;
        let mut compilation = decide(stats.as_ref());
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

    /// The sources the compiler is given, in order, and every file the box needs.
    fn inputs(&self, job: &CompilationJob, toolchain: &dyn Toolchain) -> Result<Inputs, TaskError> {
        let mut sources = Vec::new();
        let mut files = DigestMap::new();
        if self.uses_grader() {
            let grader = format!("{GRADER_BASENAME}{}", toolchain.source_extension());
            let Some(digest) = job.managers.get(&grader) else {
                return Err(TaskError::MissingManager { name: grader });
            };
            sources.push(grader.clone());
            files.insert(grader, digest.clone());
        }
        for (codename, digest) in &job.files {
            if !codename.ends_with(SOURCE_PLACEHOLDER) {
                continue;
            }
            let source = codename.replace(SOURCE_PLACEHOLDER, toolchain.source_extension());
            sources.push(source.clone());
            files.insert(source, digest.clone());
        }
        for (name, digest) in &job.managers {
            if toolchain.compiles_against(name) {
                files.insert(name.clone(), digest.clone());
            }
        }
        Ok(Inputs { sources, files })
    }

    /// The executable a compilation leaves behind, named after every codename the
    /// submission carries rather than after every source.
    fn executable_name(&self, files: &DigestMap, toolchain: &dyn Toolchain) -> String {
        let mut names: Vec<String> = files
            .keys()
            .map(|codename| codename.replace(SOURCE_PLACEHOLDER, ""))
            .collect();
        names.sort();
        format!("{}{}", names.join("_"), toolchain.executable_extension())
    }
}

/// The sources the compiler is given, and every file the box is handed, which is
/// a set by name: a manager the language reads may also be the grader.
struct Inputs {
    sources: Vec<String>,
    files: DigestMap,
}

/// Writes every file a compilation is handed into the box, in the reference's
/// own order.
fn stage_all(run: &Run, files: &DigestMap) -> Result<(), TaskError> {
    for (name, digest) in files {
        run.files()
            .write_from_storage(name, &handle(digest)?, false)?;
    }
    Ok(())
}

/// Runs the compilation commands in the box, stopping at the first that did not
/// end cleanly, and answers with what all of them cost together.
fn compile_with(
    run: &mut Run,
    commands: &[Vec<String>],
    runtime: &Runtime,
) -> Result<Option<ExecutionStats>, TaskError> {
    let mut merged: Option<ExecutionStats> = None;
    for (number, command) in commands.iter().enumerate() {
        let options = command_options(run.sandbox(), runtime, number);
        let stats = run.launch(command, &options)?;
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

/// The options one compilation command is launched under: the three limits the
/// operator set and that command's own two stream files, over the options the box
/// already carries. A compilation keeps the environment, which is what lets a
/// compiler find the toolchain it was installed with.
fn command_options(sandbox: &Sandbox, runtime: &Runtime, number: usize) -> Options {
    let limits = &runtime.compilation;
    let mut options = sandbox.options().clone();
    options.full_environment = true;
    options.cpu_time = limits.time;
    options.wall_clock_timeout = limits.time.map(wall_clock_of);
    options.address_space = limits.memory;
    options.max_processes = limits.processes;
    options.stdout_file = Some(stream_file(OUTPUT_PREFIX, number));
    options.stderr_file = Some(stream_file(ERROR_PREFIX, number));
    options
}

/// One of a command's own stream files, named by its prefix and number.
fn stream_file(prefix: &str, number: usize) -> PathBuf {
    PathBuf::from(format!("{prefix}{number}{STREAM_EXTENSION}"))
}

/// What a compilation's figures say, which is nothing at all when there was no
/// command to measure or the box itself did not work: those figures are of
/// nothing, so they are kept out of the answer too.
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
    }
}

/// The one sentence a report shows, as the list a report holds its sentences in.
fn said(message: &str) -> Vec<String> {
    vec![message.to_owned()]
}

/// The sentence for a compilation a signal killed. A run with no signal of its
/// own is named without one rather than with a number nothing wrote.
fn killed_by(signal: Option<i64>) -> String {
    signal.map_or_else(|| KILLED.to_owned(), |number| format!("{KILLED} {number}"))
}
