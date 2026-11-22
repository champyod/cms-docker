//! Communication's compilation: the stub the dataset holds, the submitted sources,
//! and the managers the language reads.
//!
//! The order is the reference's, and each step is refused before the next begins
//! because each is a dataset that cannot be compiled rather than a compilation
//! that failed: the file count first, then the stub, and only then a box.
//!
//! The stub is the first source because it holds the entry point, and it is named
//! by the language's own extension rather than by the placeholder a submission
//! uses. A manager is copied only where the language reads its extension, since a
//! file no compiler opens is a file the box does not need.
//!
//! The executable is named after the codenames the submission carries, never after
//! the stub: `get_compilation_commands` and `_executable_filename` both derive it
//! that way, and the name an evaluation looks for is the one they agree on.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::stage::Cache;

use super::super::batch::SOURCE_PLACEHOLDER;
use super::super::compiling::{self, Inputs};
use super::super::{Compilation, Runtime, TaskError, Toolchain};
use super::{Communication, STUB};

/// How many files a submission has to carry for a compilation to be attempted.
const FILES_REQUIRED: usize = 1;

impl Communication {
    /// Compiles one submission, in the order the reference does the work.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a submission with no file, a dataset with no
    /// stub where the parameters compile with one, a file the store would not hand
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
        let commands = toolchain.compilation_commands(&inputs.sources, &executable, true);
        compiling::in_a_box(job, runtime, store, inputs, executable, commands)
    }

    /// The sources the compiler is given, in order, and every file the box needs.
    fn inputs(&self, job: &CompilationJob, toolchain: &dyn Toolchain) -> Result<Inputs, TaskError> {
        let mut sources = Vec::new();
        let mut files = DigestMap::new();
        if self.uses_stub() {
            let stub = format!("{STUB}{}", toolchain.source_extension());
            let Some(digest) = job.managers.get(&stub) else {
                return Err(TaskError::MissingManager { name: stub });
            };
            sources.push(stub.clone());
            files.insert(stub, digest.clone());
        }
        for (codename, digest) in &job.files {
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
