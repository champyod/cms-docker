//! C#, Haskell, Java, Pascal, PHP and Rust, command for command from their modules.
//!
//! These are the languages whose argv is not one compiler and a list of flags: a
//! runtime handed an assembly, a shell that packs a jar, a copy that may collapse to
//! nothing, and the two compilers that are given only the file holding main.

#[path = "languages_commands_helpers.rs"]
mod support;

use cms_grading::languages::get_language;

use support::words;

#[test]
fn csharp_is_compiled_to_an_assembly_and_run_with_nothing_else() {
    let language = get_language("C# / Mono").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.cs", "sol.cs"]), "grader_sol.exe", true),
        [words(&[
            "/usr/bin/mcs",
            "-out:grader_sol.exe",
            "-optimize+",
            "grader.cs",
            "sol.cs",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["grader.cs", "sol.cs"]), "grader_sol.exe", false),
        [words(&[
            "/usr/bin/mcs",
            "-out:grader_sol.exe",
            "-optimize+",
            "grader.cs",
            "sol.cs",
        ])]
    );
    // The reference hands the runtime neither the main class nor the program's args.
    assert_eq!(
        language.evaluation_commands("grader_sol.exe", "grader", &words(&["3", "in"])),
        [words(&["/usr/bin/mono", "grader_sol.exe"])]
    );
}

#[test]
fn haskell_links_every_module_under_a_capitalised_name_then_compiles_main() {
    let language = get_language("Haskell / ghc").expect("a language");
    assert_eq!(
        language.compilation_commands(
            &words(&["grader.hs", "sol.hs", "mod/helper.hs"]),
            "grader_sol",
            true
        ),
        [
            words(&["/bin/ln", "-s", "sol.hs", "Sol.hs"]),
            words(&["/bin/ln", "-s", "helper.hs", "mod/Helper.hs"]),
            words(&[
                "/usr/bin/ghc",
                "-static",
                "-O2",
                "-Wall",
                "-o",
                "grader_sol",
                "grader.hs",
            ]),
        ]
    );
    assert_eq!(
        language.compilation_commands(
            &words(&["grader.hs", "sol.hs", "mod/helper.hs"]),
            "grader_sol",
            false
        ),
        [
            words(&["/bin/ln", "-s", "sol.hs", "Sol.hs"]),
            words(&["/bin/ln", "-s", "helper.hs", "mod/Helper.hs"]),
            words(&[
                "/usr/bin/ghc",
                "-static",
                "-O2",
                "-Wall",
                "-o",
                "grader_sol",
                "grader.hs",
            ]),
        ]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol", "grader", &[]),
        [words(&["./grader_sol"])]
    );
}

#[test]
fn java_compiles_by_javac_then_packs_the_classes_with_a_shell() {
    let language = get_language("Java / JDK").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.java", "sol.java"]), "grader_sol.jar", true),
        [
            words(&["/usr/bin/javac", "grader.java", "sol.java"]),
            words(&["/bin/sh", "-c", "jar cf grader_sol.jar *.class"]),
        ]
    );
    assert_eq!(
        language.compilation_commands(
            &words(&["grader.java", "sol.java"]),
            "grader_sol.jar",
            false
        ),
        [
            words(&["/usr/bin/javac", "grader.java", "sol.java"]),
            words(&["/bin/sh", "-c", "jar cf grader_sol.jar *.class"]),
        ]
    );
    assert_eq!(language.executable_extension(), ".jar");
    assert!(language.requires_multithreading());
}

#[test]
fn java_quotes_the_jar_name_because_a_shell_reads_the_line() {
    let language = get_language("Java / JDK").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["sol.java"]), "sol x.jar", true),
        [
            words(&["/usr/bin/javac", "sol.java"]),
            words(&["/bin/sh", "-c", "jar cf 'sol x.jar' *.class"]),
        ]
    );
}

#[test]
fn java_runs_the_jar_as_a_class_path_and_names_the_main_class() {
    let language = get_language("Java / JDK").expect("a language");
    assert_eq!(
        language.evaluation_commands("grader_sol.jar", "grader", &[]),
        [words(&[
            "/usr/bin/java",
            "-Deval=true",
            "-Xmx512M",
            "-Xss64M",
            "-cp",
            "grader_sol.jar",
            "grader",
        ])]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol.jar", "grader", &words(&["3", "in"])),
        [words(&[
            "/usr/bin/java",
            "-Deval=true",
            "-Xmx512M",
            "-Xss64M",
            "-cp",
            "grader_sol.jar",
            "grader",
            "3",
            "in",
        ])]
    );
}

#[test]
fn pascal_compiles_only_main_with_the_output_file_in_one_word() {
    let language = get_language("Pascal / fpc").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.pas", "sol.pas"]), "grader_sol", true),
        [words(&[
            "/usr/bin/fpc",
            "-dEVAL",
            "-O2",
            "-XSs",
            "-ograder_sol",
            "grader.pas",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["grader.pas", "sol.pas"]), "grader_sol", false),
        [words(&[
            "/usr/bin/fpc",
            "-O2",
            "-XSs",
            "-ograder_sol",
            "grader.pas"
        ])]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol", "grader", &[]),
        [words(&["./grader_sol"])]
    );
}

#[test]
fn php_copies_the_program_or_runs_nothing_and_then_runs_the_interpreter() {
    let language = get_language("PHP").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.php", "sol.php"]), "sol.php", true),
        [words(&["/bin/cp", "grader.php", "sol.php"])]
    );
    // The staged file already is the executable, so the compilation is a command
    // that does nothing rather than no command at all.
    assert_eq!(
        language.compilation_commands(&words(&["sol.php"]), "sol.php", true),
        [words(&["/bin/true"])]
    );
    assert_eq!(
        language.evaluation_commands("sol.php", "sol", &words(&["3"])),
        [words(&[
            "/usr/bin/php",
            "-d",
            "memory_limit=-1",
            "sol.php",
            "3"
        ])]
    );
}

#[test]
fn rust_compiles_only_the_file_holding_main() {
    let language = get_language("Rust").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["sol.rs", "other.rs"]), "sol", true),
        [words(&["/usr/bin/rustc", "-O", "-o", "sol", "sol.rs"])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["sol.rs", "other.rs"]), "sol", false),
        [words(&["/usr/bin/rustc", "-O", "-o", "sol", "sol.rs"])]
    );
    assert_eq!(
        language.evaluation_commands("sol", "sol", &words(&["3"])),
        [words(&["./sol", "3"])]
    );
}
