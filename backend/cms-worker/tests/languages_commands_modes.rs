//! Which of the thirteen languages is a different command when it is built for the
//! judge than when it is built for anyone else.
//!
//! The list is the point: a language that stops defining `EVAL` shows up here as a
//! pair of vectors that became equal, which no single-language test would notice.

use cms_worker::languages::{get_language, ALL};

/// The sources and every language that spells the evaluation definition differently.
const DEFINED: [&str; 5] = [
    "C11 / gcc",
    "C++11 / g++",
    "C++14 / g++",
    "C++17 / g++",
    "C++20 / g++",
];
/// Pascal defines it too, under Free Pascal's own flag.
const PASCAL: &str = "Pascal / fpc";

#[test]
fn five_gnu_compilers_and_pascal_build_differently_for_the_judge() {
    for name in DEFINED.iter().copied().chain([PASCAL]) {
        let language = get_language(name).expect("a language");
        let sources = vec!["sol".to_owned()];
        let judged = language.compilation_commands(&sources, "sol", true);
        let built = language.compilation_commands(&sources, "sol", false);
        assert_ne!(judged, built, "{name} must define EVAL for the judge only");
        assert_eq!(
            judged[0].len(),
            built[0].len() + 1,
            "{name} adds exactly one word"
        );
    }
}

#[test]
fn the_other_seven_build_the_same_command_either_way() {
    for language in ALL.iter() {
        let sources = vec!["sol".to_owned()];
        let judged = language.compilation_commands(&sources, "sol", true);
        let built = language.compilation_commands(&sources, "sol", false);
        if DEFINED.contains(&language.name()) || language.name() == PASCAL {
            continue;
        }
        assert_eq!(
            judged,
            built,
            "{} takes no evaluation definition",
            language.name()
        );
    }
}
