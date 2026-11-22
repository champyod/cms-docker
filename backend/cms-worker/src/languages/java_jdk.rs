//! Java, compiled and run by the system's JDK.

use std::borrow::Cow;

use shell_escape::unix::escape;

use crate::tasktypes::Toolchain;

use super::words;

/// Java, as the JDK of the machine builds and runs it.
pub struct JavaJdk;

const SOURCES: &[&str] = &[".java"];
/// A jar, because `USE_JAR` is true there; its zip branch and the unzip are not.
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
        // Quoted because /bin/sh reads this string, not an argv: a space would split it.
        let script = format!("jar cf {} *.class", escape(Cow::Borrowed(executable)));
        vec![compile, words(&[SHELL, "-c", &script])]
    }

    /// The jar is the class path and `main` the class inside it, so a run needs
    /// both, and the heap and stack are bounded before the limits have to be.
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
