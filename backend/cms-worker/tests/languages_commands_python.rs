//! The two Python 3 interpreters, whose compilation is bytecode, a rename and a zip.
//!
//! Both modules build the same three commands around a different interpreter, so the
//! tests differ only in that word: an archive whose entry point is `__main__.pyc` is
//! what PEP 441 makes runnable, and nothing about it is `-DEVAL`.

#[path = "languages_commands_helpers.rs"]
mod support;

use cms_worker::languages::get_language;

use support::words;

#[test]
fn cpython_compiles_the_entry_point_to_main_and_zips_it() {
    let language = get_language("Python 3 / CPython").expect("a language");
    assert_eq!(
        language.compilation_commands(&words(&["grader.py", "sol.py"]), "grader_sol.pyz", true),
        [
            words(&["/usr/bin/python3", "-m", "compileall", "-b", "."]),
            words(&["/bin/mv", "grader.pyc", "__main__.pyc"]),
            words(&["/usr/bin/zip", "grader_sol.pyz", "__main__.pyc", "sol.pyc",]),
        ]
    );
    assert_eq!(
        language.compilation_commands(&words(&["grader.py", "sol.py"]), "grader_sol.pyz", false),
        [
            words(&["/usr/bin/python3", "-m", "compileall", "-b", "."]),
            words(&["/bin/mv", "grader.pyc", "__main__.pyc"]),
            words(&["/usr/bin/zip", "grader_sol.pyz", "__main__.pyc", "sol.pyc",]),
        ]
    );
    assert_eq!(language.executable_extension(), ".pyz");
    assert_eq!(
        language.evaluation_commands("grader_sol.pyz", "grader", &words(&["3"])),
        [words(&["/usr/bin/python3", "grader_sol.pyz", "3"])]
    );
}

#[test]
fn pypy_compiles_a_nested_module_under_its_own_bytecode_name() {
    let language = get_language("Python 3 / PyPy").expect("a language");
    assert_eq!(
        language.compilation_commands(
            &words(&["grader.py", "pkg/util.py"]),
            "grader_sol.pyz",
            true
        ),
        [
            words(&["/usr/bin/pypy3", "-m", "compileall", "-b", "."]),
            words(&["/bin/mv", "grader.pyc", "__main__.pyc"]),
            words(&["/usr/bin/zip", "grader_sol.pyz", "__main__.pyc", "util.pyc",]),
        ]
    );
    assert_eq!(
        language.evaluation_commands("grader_sol.pyz", "grader", &[]),
        [words(&["/usr/bin/pypy3", "grader_sol.pyz"])]
    );
}
