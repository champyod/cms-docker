//! C11, compiled with the system's gcc.

use crate::tasktypes::Toolchain;

use super::words;

/// The C11 standard, as the gcc of the machine compiles it.
pub struct C11Gcc;

const SOURCES: &[&str] = &[".c"];
const HEADERS: &[&str] = &[".h"];
const OBJECTS: &[&str] = &[".o"];
/// The compiler the reference names by its full path, so a box with a short PATH
/// still compiles, and so the argv a test pins is the argv the box runs.
const COMPILER: &str = "/usr/bin/gcc";
/// What a compilation the judge runs defines, so a grader can tell it is being
/// compiled for evaluation rather than for the contestant's own build.
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
        command.extend(words(&["-std=gnu11", "-O2", "-pipe", "-static", "-s", "-o"]));
        command.push(executable.to_owned());
        command.extend(sources.iter().cloned());
        command.push("-lm".to_owned());
        vec![command]
    }
}
