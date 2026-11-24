#![deny(missing_docs)]
#![forbid(unsafe_code)]

//! Grading order lives in task types while runtime, language and store stay caller-owned.

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
mod parameters;
mod registry;
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
pub use parameters::{Accepts, Parameter};
pub use registry::TaskType;
pub use two_steps::TwoSteps;

pub(crate) use boxed::{Closed, Run, Shared};
pub(crate) use parameters::Parameters;

use crate::stage::{CacheHandle, FileDigest, StageError};

const WALL_CLOCK_MULTIPLIER: u32 = 2;
/// What stopping a run costs it on top of its own limit, in seconds.
const WALL_CLOCK_GRACE: Duration = Duration::from_secs(1);

/// Languages supply commands without making task types depend on installed toolchains.
pub trait Toolchain {
    /// Identifies the compiler and version an operator configured.
    fn name(&self) -> &str;

    /// Lists accepted source suffixes with the canonical one first.
    fn source_extensions(&self) -> &[&str];

    /// Chooses the canonical suffix for generated grader and executable names.
    fn source_extension(&self) -> &str {
        self.source_extensions()
            .first()
            .copied()
            .unwrap_or_default()
    }

    /// Names headers that make a dataset manager part of compilation.
    fn header_extensions(&self) -> &[&str] {
        &[]
    }

    /// Names precompiled managers that can be linked without compilation.
    fn object_extensions(&self) -> &[&str] {
        &[]
    }

    /// Keeps language-specific executable names distinct at evaluation time.
    fn executable_extension(&self) -> &str {
        ""
    }

    /// Lets a contest widen process limits when any allowed language needs it.
    fn requires_multithreading(&self) -> bool {
        false
    }

    /// Prevents unrelated dataset files from entering a compilation box.
    fn compiles_against(&self, manager: &str) -> bool {
        self.source_extensions()
            .iter()
            .chain(self.header_extensions())
            .chain(self.object_extensions())
            .any(|extension| manager.ends_with(extension))
    }

    /// Preserves the entry point and judge-only flags each language requires.
    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        for_evaluation: bool,
    ) -> Vec<Vec<String>>;

    /// Lets interpreted languages launch their artifact differently from native ones.
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
/// Holds the operator's compilation bounds so task types need no configuration lookup.
pub struct CompilationLimits {
    /// The CPU time a compilation is charged, in seconds.
    pub time: Option<Duration>,
    /// The memory a compilation may address, in bytes.
    pub memory: Option<u64>,
    /// How many processes a compilation may have alive at once.
    pub processes: Option<u32>,
}

pub(super) fn wall_clock_of(cpu_time: Duration) -> Duration {
    cpu_time * WALL_CLOCK_MULTIPLIER + WALL_CLOCK_GRACE
}

/// A handle for a digest a job carries, which the store is asked for by.
pub(super) fn handle(digest: &str) -> Result<CacheHandle, TaskError> {
    let digest = FileDigest::from_str(digest)
        .map_err(|error| TaskError::Stage(StageError::Digest(error)))?;
    Ok(CacheHandle::new(digest))
}
