//! C#, compiled with mono's `mcs` and run by the `mono` runtime.

use crate::tasktypes::Toolchain;

use super::words;

/// C#, as the mono compiler of the machine builds it.
pub struct CSharpMono;

const SOURCES: &[&str] = &[".cs"];
const COMPILER: &str = "/usr/bin/mcs";
const RUNTIME: &str = "/usr/bin/mono";
/// A mono assembly, which is what `mcs` writes and what `mono` is handed.
const EXECUTABLE: &str = ".exe";

impl Toolchain for CSharpMono {
    fn name(&self) -> &str {
        "C# / Mono"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn executable_extension(&self) -> &str {
        EXECUTABLE
    }

    /// The runtime manages its own threads for a program that asks for them.
    fn requires_multithreading(&self) -> bool {
        true
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        let mut command = words(&[COMPILER]);
        command.push(format!("-out:{executable}"));
        command.push("-optimize+".to_owned());
        command.extend(sources.iter().cloned());
        vec![command]
    }

    /// The runtime is handed the assembly and nothing else: the reference passes
    /// neither the main class nor the program's own arguments here.
    fn evaluation_commands(
        &self,
        executable: &str,
        _main: &str,
        _args: &[String],
    ) -> Vec<Vec<String>> {
        vec![words(&[RUNTIME, executable])]
    }
}
