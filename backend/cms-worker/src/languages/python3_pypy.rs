//! Python 3, compiled with the system's PyPy.

use std::path::Path;

use crate::tasktypes::Toolchain;

use super::words;

/// Python 3, as the PyPy of the machine runs it.
pub struct Python3Pypy;

const SOURCES: &[&str] = &[".py"];
const INTERPRETER: &str = "/usr/bin/pypy3";
/// The name a zip of bytecode is looked for by, as PEP 441 defines it.
const MAIN: &str = "__main__.pyc";
const EXECUTABLE: &str = ".pyz";

impl Toolchain for Python3Pypy {
    fn name(&self) -> &str {
        "Python 3 / PyPy"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn executable_extension(&self) -> &str {
        EXECUTABLE
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        let mut commands = vec![words(&[INTERPRETER, "-m", "compileall", "-b", "."])];
        let mut packaged = Vec::new();
        for (index, source) in sources.iter().enumerate() {
            let compiled = format!("{}.pyc", stem(source));
            // Same contract as CPython's: the entry point becomes the file the zip
            // is run by, and every other module keeps its own name.
            if index == 0 {
                commands.push(words(&["/bin/mv", &compiled, MAIN]));
                packaged.push(MAIN.to_owned());
            } else {
                packaged.push(compiled);
            }
        }
        let mut zip = words(&["/usr/bin/zip", executable]);
        zip.extend(packaged);
        commands.push(zip);
        commands
    }

    fn evaluation_commands(
        &self,
        executable: &str,
        _main: &str,
        args: &[String],
    ) -> Vec<Vec<String>> {
        let mut command = words(&[INTERPRETER, executable]);
        command.extend(args.iter().cloned());
        vec![command]
    }
}

/// The file name without its extension, which is what `compileall -b` names the
/// bytecode after.
fn stem(source: &str) -> String {
    Path::new(source)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
