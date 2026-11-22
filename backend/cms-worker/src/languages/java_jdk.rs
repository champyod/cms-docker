//! Java, compiled and run by the system's JDK.

use std::borrow::Cow;

use shell_escape::unix::escape;

use crate::tasktypes::Toolchain;

use super::words;

/// Java, as the JDK of the machine builds and runs it.
pub struct JavaJdk;

const SOURCES: &[&str] = &[".java"];
/// A jar, because `USE_JAR` is true in the reference; the zip it can build
/// instead, and the unzip before a run, are not ported with it.
const EXECUTABLE: &str = ".jar";
const COMPILER: &str = "/usr/bin/javac";
const RUNTIME: &str = "/usr/bin/java";
/// The jar tool is shelled out to: only a shell expands the `*.class` javac wrote.
const SHELL: &str = "/bin/sh";

impl Toolchain for JavaJdk {
    fn name(&self) -> &str {
        "Java / JDK"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn executable_extension(&self) -> &str {
        EXECUTABLE
    }

    /// The JVM starts its own threads before it runs a line of the program.
    fn requires_multithreading(&self) -> bool {
        true
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        let mut compile = words(&[COMPILER]);
        compile.extend(sources.iter().cloned());
        // The name is quoted because this string is a shell command, not an argv:
        // an unquoted one with a space is two words to `jar`, and the submission
        // then cannot compile for a reason nothing in the box explains.
        let script = format!("jar cf {} *.class", escape(Cow::Borrowed(executable)));
        vec![compile, words(&[SHELL, "-c", &script])]
    }

    /// The jar is the class path and `main` is the class inside it, so the run
    /// needs both; the JVM is also told it is evaluating, and bounded in heap and
    /// stack so a submission cannot take the box down before the limits do.
    fn evaluation_commands(
        &self,
        executable: &str,
        main: &str,
        args: &[String],
    ) -> Vec<Vec<String>> {
        let mut command = words(&[
            RUNTIME,
            "-Deval=true",
            "-Xmx512M",
            "-Xss64M",
            "-cp",
            executable,
            main,
        ]);
        command.extend(args.iter().cloned());
        vec![command]
    }
}
