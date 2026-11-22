//! C++20, compiled with the system's g++.

use crate::tasktypes::Toolchain;

use super::words;

/// C++20, as the g++ of the machine compiles it.
pub struct Cpp20Gpp;

const SOURCES: &[&str] = &[".cpp", ".cc", ".cxx", ".c++", ".C"];
const HEADERS: &[&str] = &[".h"];
const OBJECTS: &[&str] = &[".o"];
const COMPILER: &str = "/usr/bin/g++";
const EVAL: &str = "-DEVAL";

impl Toolchain for Cpp20Gpp {
    fn name(&self) -> &str {
        "C++20 / g++"
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
        command.extend(words(&["-std=gnu++20", "-O2", "-pipe", "-static", "-s", "-o"]));
        command.push(executable.to_owned());
        command.extend(sources.iter().cloned());
        vec![command]
    }
}
