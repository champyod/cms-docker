//! Two Steps' compilation: the manager the dataset holds, its header, the two
//! submitted sources and their headers, all built into one executable.
//!
//! The order is the reference's, and it is what the languages need: the manager
//! first because it holds the entry point, its header beside it, then each
//! submitted source followed by the header that source is compiled against.
//!
//! A header is a manager of the dataset rather than a file a submission carries,
//! so a dataset without one is a compilation that cannot be attempted: it is
//! refused before the box is made, as the manager itself is.
//!
//! The executable is named `manager` with the language's extension, not after a
//! codename, because both phases run the same program told which step it is.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::stage::Cache;

use super::super::batch::SOURCE_PLACEHOLDER;
use super::super::compiling::{self, Inputs};
use super::super::{Compilation, Runtime, TaskError, Toolchain};
use super::TwoSteps;

/// How many files a submission has to carry: the two the task type is for, and no
/// other count, since a third is a submission format that is not this task's.
const FILES_REQUIRED: usize = 2;
const MANAGER_BASENAME: &str = "manager";

impl TwoSteps {
    /// Compiles one submission, in the order the reference does the work.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a submission that does not carry exactly two
    /// files, a dataset missing the manager, its header or a submitted file's
    /// header, a file the store would not hand over, a stream file it would not
    /// keep, and a run the box could not carry.
    pub fn compile(
        &self,
        job: &CompilationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Compilation, TaskError> {
        if job.files.len() != FILES_REQUIRED {
            return Err(TaskError::TooFewFiles {
                found: job.files.len(),
                wanted: FILES_REQUIRED,
            });
        }
        let inputs = self.inputs(job, toolchain)?;
        let executable = format!("{MANAGER_BASENAME}{}", toolchain.executable_extension());
        let commands = toolchain.compilation_commands(&inputs.sources, &executable, true);
        compiling::in_a_box(job, runtime, store, inputs, executable, commands)
    }

    /// The sources the compiler is given, in order, and every file the box needs.
    fn inputs(&self, job: &CompilationJob, toolchain: &dyn Toolchain) -> Result<Inputs, TaskError> {
        let mut sources = Vec::new();
        let mut files = DigestMap::new();
        // The canonical header, which is the first of the list the language names.
        let header = toolchain.header_extensions().first().copied();
        let manager = format!("{MANAGER_BASENAME}{}", toolchain.source_extension());
        held(job, &mut sources, &mut files, &manager)?;
        if let Some(header) = header {
            let named = format!("{MANAGER_BASENAME}{header}");
            held(job, &mut sources, &mut files, &named)?;
        }
        for (codename, digest) in &job.files {
            let source = codename.replace(SOURCE_PLACEHOLDER, toolchain.source_extension());
            sources.push(source.clone());
            files.insert(source, digest.clone());
            if let Some(header) = header {
                let named = codename.replace(SOURCE_PLACEHOLDER, header);
                held(job, &mut sources, &mut files, &named)?;
            }
        }
        Ok(Inputs { sources, files })
    }
}

/// One file the dataset holds, added to the command and to the box; a dataset
/// without it is refused here, before the box exists.
fn held(
    job: &CompilationJob,
    sources: &mut Vec<String>,
    files: &mut DigestMap,
    name: &str,
) -> Result<(), TaskError> {
    let Some(digest) = job.managers.get(name) else {
        return Err(TaskError::MissingManager {
            name: name.to_owned(),
        });
    };
    sources.push(name.to_owned());
    files.insert(name.to_owned(), digest.clone());
    Ok(())
}
