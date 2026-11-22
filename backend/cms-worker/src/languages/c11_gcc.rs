//! C11, compiled with the system's gcc.

use crate::tasktypes::Toolchain;

use super::words;

/// The C11 standard, as the gcc of the machine compiles it.
pub struct C11Gcc;

const SOURCES: &[&str] = &[".c"];
const HEADERS: &[&str] = &[".h"];
const OBJECTS: &[&str] = &[".o"];
/// Every flag before the output file, whose own two words follow them.
const FLAGS: &[&str] = &["-std=gnu11", "-O2", "-pipe", "-static", "-s", "-o"];
/// The compiler by its full path, so a short PATH cannot pick a different one.
const COMPILER: &str = "/usr/bin/gcc";
/// What a compilation the judge runs defines, and no other compilation sees.
const EVAL: &str = "-DEVAL";

impl Toolchain for C11Gcc {
    fn name(&self) -> &str {
        "C11 / gcc"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn header_extensions(&self) -> &[&str] {
        HEADERS
    }

    fn object_extensions(&self) -> &[&str] {
        OBJECTS
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        let mut command = words(&[COMPILER]);
        if for_evaluation {
            command.push(EVAL.to_owned());
        }
        command.extend(words(FLAGS));
        command.push(executable.to_owned());
        command.extend(sources.iter().cloned());
        command.push("-lm".to_owned());
        vec![command]
    }
}
