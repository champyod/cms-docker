//! The Batch task type's compilation: the sources a submission carries, the
//! grader it may be compiled with, and the executable they become.
//!
//! The order is the reference's: a grader goes to the compiler first where there
//! is one, then the sources, and the executable is named after the codenames. A
//! dataset with no grader where a grader is compiled is refused before a box is
//! made, because it is a dataset that cannot be compiled rather than one that
//! failed to compile.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::stage::Cache;

use super::batch::{Batch, GRADER_BASENAME, SOURCE_PLACEHOLDER};
use super::compiling::{self, Inputs};
use super::{Compilation, Runtime, TaskError, Toolchain};

/// How many files a submission has to carry for a compilation to be attempted.
const FILES_REQUIRED: usize = 1;

impl Batch {
    /// Compiles one submission, in the order the reference does the work.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: too few submitted files, a dataset with no
    /// grader manager where a grader is compiled, a file the store would not hand
    /// over, a stream file it would not keep, and a run the box could not carry.
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
        let executable = compiling::executable_name(job.files.keys(), toolchain);
        // What the worker builds is run by the judge, so it is compiled for it.
        let commands = toolchain.compilation_commands(&inputs.sources, &executable, true);
        compiling::in_a_box(job, runtime, store, inputs, executable, commands)
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
}
