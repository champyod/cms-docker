//! Rust, compiled with the system's rustc.

use crate::tasktypes::Toolchain;

use super::words;

/// Rust, as the rustc of the machine compiles it.
pub struct Rust;

const SOURCES: &[&str] = &[".rs"];
const COMPILER: &str = "/usr/bin/rustc";

impl Toolchain for Rust {
    fn name(&self) -> &str {
        "Rust"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        // Only the file holding main is passed: rustc follows `mod` itself.
        let mut command = words(&[COMPILER, "-O", "-o"]);
        command.push(executable.to_owned());
        command.push(sources[0].clone());
        vec![command]
    }
}
