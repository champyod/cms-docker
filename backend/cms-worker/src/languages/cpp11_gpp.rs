//! C++11, compiled with the system's g++.

use crate::tasktypes::Toolchain;

use super::words;

/// C++11, as the g++ of the machine compiles it.
pub struct Cpp11Gpp;

/// Five extensions, because a contestant may submit any of them; the first is
/// the one CMS names a rewritten codename by.
const SOURCES: &[&str] = &[".cpp", ".cc", ".cxx", ".c++", ".C"];
const HEADERS: &[&str] = &[".h"];
const OBJECTS: &[&str] = &[".o"];
/// The compiler the reference names by its full path, as every toolchain here does.
const COMPILER: &str = "/usr/bin/g++";
const EVAL: &str = "-DEVAL";

impl Toolchain for Cpp11Gpp {
    fn name(&self) -> &str {
        "C++11 / g++"
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
        command.extend(words(&["-std=gnu++11", "-O2", "-pipe", "-static", "-s", "-o"]));
        command.push(executable.to_owned());
        command.extend(sources.iter().cloned());
        vec![command]
    }
}
