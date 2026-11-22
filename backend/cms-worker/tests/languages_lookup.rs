//! Which language a name means, which one a filename belongs to, and the two
//! answers a contest reads off a language before a job is built.

use cms_worker::job::BuildError;
use cms_worker::languages::{
    describe, filename_to_language, get_language, is_multithreaded, safe_get_lang_filename, ALL,
};

#[test]
fn the_thirteen_languages_are_the_reference_s_own_names() {
    let mut names: Vec<&str> = ALL.iter().map(|language| language.name()).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "C# / Mono",
            "C++11 / g++",
            "C++14 / g++",
            "C++17 / g++",
            "C++20 / g++",
            "C11 / gcc",
            "Haskell / ghc",
            "Java / JDK",
            "PHP",
            "Pascal / fpc",
            "Python 3 / CPython",
            "Python 3 / PyPy",
            "Rust",
        ]
    );
}

#[test]
fn a_name_is_looked_up_exactly_and_a_near_miss_is_refused() {
    let found = get_language("C++17 / g++").expect("the name the reference gives it");
    assert_eq!(found.name(), "C++17 / g++");
    assert_eq!(
        found.source_extensions(),
        [".cpp", ".cc", ".cxx", ".c++", ".C"]
    );

    assert_eq!(
        get_language("C++17").err(),
        Some(BuildError::UnknownLanguage {
            language: Some("C++17".to_owned()),
        })
    );
}

#[test]
fn a_canonical_extension_is_the_first_of_the_list() {
    let cpp = get_language("C++20 / g++").expect("a language");
    assert_eq!(cpp.source_extension(), ".cpp");
    let pascal = get_language("Pascal / fpc").expect("a language");
    assert_eq!(pascal.header_extensions(), ["lib.pas"]);
    let java = get_language("Java / JDK").expect("a language");
    assert_eq!(java.executable_extension(), ".jar");
}

#[test]
fn a_manager_is_one_the_language_reads_by_any_of_its_three_lists() {
    let cpp = get_language("C++11 / g++").expect("a language");
    assert!(cpp.compiles_against("grader.cpp"));
    assert!(cpp.compiles_against("grader.cc"));
    assert!(cpp.compiles_against("grader.h"));
    assert!(cpp.compiles_against("grader.o"));
    assert!(!cpp.compiles_against("README"));
    assert!(!cpp.compiles_against("grader.c"));
}

#[test]
fn a_filename_belongs_to_the_language_whose_extension_it_ends_with() {
    let python = filename_to_language("sol.py").expect("two languages take .py");
    assert_eq!(python.name(), "Python 3 / CPython");
    assert_eq!(
        filename_to_language("sol.C").map(|language| language.name()),
        Some("C++11 / g++")
    );
    assert_eq!(
        filename_to_language("a/b/sol.pas").map(|language| language.name()),
        Some("Pascal / fpc")
    );
    assert!(filename_to_language("README").is_none());
    assert!(filename_to_language("grader.h").is_none());
}

#[test]
fn a_filename_template_takes_the_extension_or_says_it_was_not_resolved() {
    assert_eq!(
        safe_get_lang_filename(Some("Rust"), "sol.%l"),
        "sol.rs".to_owned()
    );
    assert_eq!(
        safe_get_lang_filename(Some("Python 3 / PyPy"), "manager.%l"),
        "manager.py".to_owned()
    );
    assert_eq!(safe_get_lang_filename(None, "sol.%l"), "sol.%l".to_owned());
    assert_eq!(
        safe_get_lang_filename(Some("C++"), "sol.%l"),
        "sol.invalid_language".to_owned()
    );
}

#[test]
fn a_contest_is_multithreaded_when_any_language_it_allows_is() {
    assert!(!is_multithreaded(&[]));
    assert!(!is_multithreaded(&["PHP", "Rust"]));
    assert!(is_multithreaded(&["PHP", "Java / JDK"]));
    assert!(is_multithreaded(&["C# / Mono"]));
    // A name the worker does not know cannot make a contest multithreaded.
    assert!(!is_multithreaded(&["Java"]));
}

#[test]
fn the_descriptor_carries_the_lists_and_the_flag_the_job_reads() {
    let csharp = describe("C# / Mono").expect("a language");
    assert_eq!(csharp.source_extension, ".cs");
    assert!(csharp.header_extensions.is_empty());
    assert!(csharp.requires_multithreading);

    let pascal = describe("Pascal / fpc").expect("a language");
    assert_eq!(pascal.header_extensions, ["lib.pas".to_owned()]);
    assert_eq!(pascal.object_extensions, [".o".to_owned()]);
    assert!(!pascal.requires_multithreading);

    assert!(describe("C++").is_none());
}
