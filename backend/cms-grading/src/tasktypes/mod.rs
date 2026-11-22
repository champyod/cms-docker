//! What a task type does with one job: the files it is handed, the runs it makes,
//! and what those runs are worth.
//!
//! A task type is the part of a worker that knows what a task *is*. Everything it
//! needs from the machine is already here — [`cms_sandbox`] launches a run and
//! reads back what it left behind, [`crate::stage`] hands it files and takes them
//! away again — so a task type is the order those two are used in and nothing
//! else. That order is the task type's own, and it is what differs between one
//! task type and the next.
//!
//! [`Batch`] is the one for a submission that is a single program judged by what
//! it prints, compiled either by itself or together with a grader the dataset
//! holds. It is two phases, each a flat run of early returns in the order the
//! reference does the work: `Batch::compile` stages the sources and the managers
//! the language reads, runs the compilation commands and collects the
//! executable; `Batch::evaluate` stages the executable and the input, runs it
//! under the dataset's limits, maps what came back to an outcome, and judges the
//! answer it wrote.
//!
//! [`OutputOnly`] is the one for a submission that is a list of answers rather than
//! a program: nothing is compiled, and a testcase is judged on the file the
//! submission carried for it. [`BatchAndOutput`] is the one for a task whose
//! testcases are answered either way, and it decides which of the two it is in the
//! order the reference does: a carried answer wins over a run, a testcase the
//! dataset listed as output-only is never run, and everything else is a [`Batch`]
//! testcase whose two phases are reused unchanged.
//!
//! Every one of them ends in [`eval_output`], which is the judge: the answer is
//! compared with the dataset's by a checker it holds or by a white diff, and the
//! score, the sentence a contestant is shown and the sentence an administrator is
//! shown are what it returns. That is what makes an unjudged run impossible to hand
//! on rather than merely discouraged.
//!
//! Three things are the caller's, because none of them is a task type's business.
//! The language a job names is a [`Toolchain`], and the lookup that produced it
//! lives with the languages the worker was configured with. Where a box is made
//! and what a compilation is held to is a [`Runtime`]. The store the files come
//! from and go to is a [`Cache`], which a phase is handed rather than looks up.
//! All three answer in values and never in lookups, so a task type can be
//! exercised without a machine.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the entries a task type has,
//! a dataset holding no grader manager a grader compilation needs, a
//! submission carrying too few files, a result carrying the wrong number of
//! executables, a limit a dataset set that is not a positive number, a file the
//! store would not hand over, and a run the box could not carry or read back.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod batch;
mod batch_and_output;
mod boxed;
mod communication;
mod compile;
mod compiling;
mod error;
mod evaluate;
mod judge;
mod kinds_answer;
mod outcome;
mod output_only;
mod two_steps;

use std::str::FromStr;
use std::time::Duration;

pub use batch::Batch;
pub use batch_and_output::{Answer as BatchAndOutputAnswer, BatchAndOutput, Origin};
pub use boxed::Runtime;
pub use communication::{Communication, Verdict};
pub use compiling::Compilation;
pub use error::TaskError;
pub use judge::{eval_output, Judgement, OutputSource};
pub use outcome::{Evaluation, OutputFile};
pub use output_only::{Answer as OutputOnlyAnswer, OutputOnly};
pub use two_steps::TwoSteps;

pub(crate) use boxed::{Run, Shared};
/// The sentence a run that was stopped by its time limit is reported with, which the score
/// types read to show a row as having run past the limit rather than as having taken a time.
pub(crate) use outcome::TIMED_OUT;

use crate::stage::{CacheHandle, FileDigest, StageError};

/// How many times a CPU limit is charged against the wall clock a run must finish
/// inside, because a run that is stopped is still charged for being stopped.
const WALL_CLOCK_MULTIPLIER: u32 = 2;
/// What stopping a run costs it on top of its own limit, in seconds.
const WALL_CLOCK_GRACE: Duration = Duration::from_secs(1);

/// One programming language, as a compilation and an evaluation each need it.
///
/// The lookup that turns the name a job carries into one of these is the
/// caller's, and lives with the languages the worker was configured with: a name
/// it does not know is refused there, as it is in
/// [`crate::job::BuildError::UnknownLanguage`].
pub trait Toolchain {
    /// The name the language is filed under, which names the compiler and its
    /// version too, e.g. `C++17 / g++` rather than `C++`.
    fn name(&self) -> &str;

    /// The extensions a source of this language has, the canonical one first.
    ///
    /// Plural because a contestant may submit any of them (five for C++), while
    /// `grader.%l` and a submitted codename take the first one alone.
    fn source_extensions(&self) -> &[&str];

    /// The canonical source extension, which is what `grader.%l` becomes and
    /// what a submitted codename is rewritten to.
    fn source_extension(&self) -> &str {
        self.source_extensions()
            .first()
            .copied()
            .unwrap_or_default()
    }

    /// The extensions a header of this language has, each of which makes a
    /// manager of the dataset one this language's compilation is handed.
    fn header_extensions(&self) -> &[&str] {
        &[]
    }

    /// The extensions a compiled object of this language has, which a manager
    /// may arrive as instead of a source or a header.
    fn object_extensions(&self) -> &[&str] {
        &[]
    }

    /// The extension an executable of this language has, appended to the name
    /// the task type chose for it. Empty for a language that tells its
    /// executables apart by nothing else.
    fn executable_extension(&self) -> &str {
        ""
    }

    /// Whether running this language needs more than one thread, which is a
    /// property of the language rather than of a contest: a contest is
    /// multithreaded when any language it allows is, and the answer is what a
    /// job's `multithreaded_sandbox` carries into the box.
    fn requires_multithreading(&self) -> bool {
        false
    }

    /// Whether a manager is one this language's compilation reads: a source, a
    /// header or an object extension it names, and nothing else.
    fn compiles_against(&self, manager: &str) -> bool {
        self.source_extensions()
            .iter()
            .chain(self.header_extensions())
            .chain(self.object_extensions())
            .any(|extension| manager.ends_with(extension))
    }

    /// The commands that compile `sources` into `executable`.
    ///
    /// The first source is the one holding the entry point, which is the order
    /// some languages need, and the commands run in the order they are given.
    /// `for_evaluation` adds what only a compilation the judge runs is given —
    /// `-DEVAL` for the GNU compilers, `-dEVAL` for Pascal — because the same
    /// program built for anything else must not see it.
    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        for_evaluation: bool,
    ) -> Vec<Vec<String>>;

    /// The commands that run `executable`, judged by `main` where a language
    /// names its main class or module separately from the executable holding it.
    /// `args` are the arguments the program itself is run with, which a task type
    /// whose run is told where to find another one by name needs, and empty for
    /// a run told nothing.
    ///
    /// The default is the whole of the reference's `CompiledLanguage`: the file
    /// the compilation left, run as `./name`. The three languages that compile to
    /// something an interpreter is handed — C#, Java, PHP — answer for
    /// themselves.
    fn evaluation_commands(
        &self,
        executable: &str,
        _main: &str,
        args: &[String],
    ) -> Vec<Vec<String>> {
        let mut command = vec![format!("./{executable}")];
        command.extend(args.iter().cloned());
        vec![command]
    }
}

/// The three numbers a compilation is held to.
///
/// They are configuration rather than a task type's business, and a limit the
/// operator set to none is sent as no limit at all, so the box's own default
/// stands.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CompilationLimits {
    /// The CPU time a compilation is charged, in seconds.
    pub time: Option<Duration>,
    /// The memory a compilation may address, in bytes.
    pub memory: Option<u64>,
    /// How many processes a compilation may have alive at once.
    pub processes: Option<u32>,
}

/// The clock a run charged this CPU time must finish inside: twice the limit
/// plus a second, since stopping a run is not instant.
pub(super) fn wall_clock_of(cpu_time: Duration) -> Duration {
    cpu_time * WALL_CLOCK_MULTIPLIER + WALL_CLOCK_GRACE
}

/// A handle for a digest a job carries, which the store is asked for by.
pub(super) fn handle(digest: &str) -> Result<CacheHandle, TaskError> {
    let digest = FileDigest::from_str(digest)
        .map_err(|error| TaskError::Stage(StageError::Digest(error)))?;
    Ok(CacheHandle::new(digest))
}
