//! PHP, run by the system's interpreter.

use crate::tasktypes::Toolchain;

use super::words;

/// PHP, as the interpreter of the machine runs it.
pub struct Php;

const SOURCES: &[&str] = &[".php"];
const INTERPRETER: &str = "/usr/bin/php";
/// The staged file is the program, copied under the executable's name.
const COPY: &str = "/bin/cp";
/// A compilation with nothing to do is still a command, so it is charged anyway.
const NOTHING: &str = "/bin/true";

impl Toolchain for Php {
    fn name(&self) -> &str {
        "PHP"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn executable_extension(&self) -> &str {
        ".php"
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        if sources[0] != executable {
            return vec![words(&[COPY, &sources[0], executable])];
        }
        vec![words(&[NOTHING])]
    }

    fn evaluation_commands(
        &self,
        executable: &str,
        _main: &str,
        args: &[String],
    ) -> Vec<Vec<String>> {
        let mut command = words(&[INTERPRETER, "-d", "memory_limit=-1", executable]);
        command.extend(args.iter().cloned());
        vec![command]
    }
}
