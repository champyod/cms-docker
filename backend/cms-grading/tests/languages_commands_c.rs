//! C11 and the four C++ standards, command for command from their reference modules.
//!
//! Each test is the whole argv in both directions: what the compiler is handed for
//! an evaluation, what it is handed for any other build, and what the run is.

#[path = "languages_commands_helpers.rs"]
mod support;

use cms_grading::languages::get_language;

use support::words;

#[test]
fn c11_compiles_for_evaluation_and_runs_the_executable() {
    let language = get_language("C11 / gcc").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.c", "sol.c"]), "grader_sol", true),
        [words(&[
            "/usr/bin/gcc",
            "-DEVAL",
            "-std=gnu11",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "grader_sol",
            "grader.c",
            "sol.c",
            "-lm",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["grader.c", "sol.c"]), "grader_sol", false),
        [words(&[
            "/usr/bin/gcc",
            "-std=gnu11",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "grader_sol",
            "grader.c",
            "sol.c",
            "-lm",
        ])]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol", "grader", &[]),
        [words(&["./grader_sol"])]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol", "grader", &words(&["3", "in"])),
        [words(&["./grader_sol", "3", "in"])]
    );
}

#[test]
fn cpp11_compiles_for_evaluation_and_runs_the_executable() {
    let language = get_language("C++11 / g++").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.cpp", "sol.cc"]), "grader_sol", true),
        [words(&[
            "/usr/bin/g++",
            "-DEVAL",
            "-std=gnu++11",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "grader_sol",
            "grader.cpp",
            "sol.cc",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["grader.cpp", "sol.cc"]), "grader_sol", false),
        [words(&[
            "/usr/bin/g++",
            "-std=gnu++11",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "grader_sol",
            "grader.cpp",
            "sol.cc",
        ])]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol", "grader", &words(&["3"])),
        [words(&["./grader_sol", "3"])]
    );
}

#[test]
fn cpp14_compiles_for_evaluation_and_runs_the_executable() {
    let language = get_language("C++14 / g++").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["sol.cpp"]), "sol", true),
        [words(&[
            "/usr/bin/g++",
            "-DEVAL",
            "-std=gnu++14",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "sol",
            "sol.cpp",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["sol.cpp"]), "sol", false),
        [words(&[
            "/usr/bin/g++",
            "-std=gnu++14",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "sol",
            "sol.cpp",
        ])]
    );
    assert_eq!(
        language.evaluation_commands("sol", "sol", &[]),
        [words(&["./sol"])]
    );
}

#[test]
fn cpp17_compiles_for_evaluation_and_runs_the_executable() {
    let language = get_language("C++17 / g++").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["sol.cxx"]), "sol", true),
        [words(&[
            "/usr/bin/g++",
            "-DEVAL",
            "-std=gnu++17",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "sol",
            "sol.cxx",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["sol.cxx"]), "sol", false),
        [words(&[
            "/usr/bin/g++",
            "-std=gnu++17",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "sol",
            "sol.cxx",
        ])]
    );
    assert_eq!(
        language.evaluation_commands("sol", "sol", &[]),
        [words(&["./sol"])]
    );
}

#[test]
fn cpp20_compiles_for_evaluation_and_runs_the_executable() {
    let language = get_language("C++20 / g++").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["sol.c++"]), "sol", true),
        [words(&[
            "/usr/bin/g++",
            "-DEVAL",
            "-std=gnu++20",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "sol",
            "sol.c++",
        ])]
    );
    assert_eq!(
        language.compilation_commands(&words(&["sol.c++"]), "sol", false),
        [words(&[
            "/usr/bin/g++",
            "-std=gnu++20",
            "-O2",
            "-pipe",
            "-static",
            "-s",
            "-o",
            "sol",
            "sol.c++",
        ])]
    );
    assert_eq!(
        language.evaluation_commands("sol", "sol", &[]),
        [words(&["./sol"])]
    );
}
