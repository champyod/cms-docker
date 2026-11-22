//! A language that answers with the commands a test chose, and nothing a real one does.
//!
//! A task type is written against a language rather than against a compiler, so a test
//! of a task type names the commands it expects to see run and reads them back from the
//! box, which is what makes the order of a phase visible without a toolchain installed.

#![allow(dead_code)]

use cms_worker::tasktypes::Toolchain;

/// A language that answers with the commands a test chose.
pub struct StubToolchain;

impl Toolchain for StubToolchain {
    fn source_extension(&self) -> &str {
        ".cpp"
    }

    fn executable_extension(&self) -> &str {
        ""
    }

    fn compiles_against(&self, manager: &str) -> bool {
        manager.ends_with(".cpp") || manager.ends_with(".h")
    }

    fn compilation_commands(&self, sources: &[String], executable: &str) -> Vec<Vec<String>> {
        vec![vec![format!("compile {executable}"), sources.join(" ")]]
    }

    fn evaluation_commands(
        &self,
        executable: &str,
        main: &str,
        args: &[String],
    ) -> Vec<Vec<String>> {
        let mut command = vec![format!("run {executable}"), main.to_owned()];
        command.extend(args.iter().cloned());
        vec![command]
    }
}
