//! C++14, compiled with the system's g++.

use crate::tasktypes::Toolchain;

use super::words;

/// C++14, as the g++ of the machine compiles it.
pub struct Cpp14Gpp;

const SOURCES: &[&str] = &[".cpp", ".cc", ".cxx", ".c++", ".C"];
const HEADERS: &[&str] = &[".h"];
const OBJECTS: &[&str] = &[".o"];
/// Every flag the compilation carries before the output file, whose own two
/// words follow them.
const FLAGS: &[&str] = &["-std=gnu++14", "-O2", "-pipe", "-static", "-s", "-o"];
const COMPILER: &str = "/usr/bin/g++";
const EVAL: &str = "-DEVAL";

impl Toolchain for Cpp14Gpp {
    fn name(&self) -> &str {
        "C++14 / g++"
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
        vec![command]
    }
}
