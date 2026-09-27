//! The two user test paths, and the one thing each does that the other does not.
//!
//! The fixtures are the records the constructors read and nothing else: no task
//! type is instantiated and no sandbox exists, so the merge and the two points
//! where the paths part are decided by the records handed in.

use std::collections::BTreeMap;

use cms_proto::{DigestMap, Operation, OperationKind};
use cms_worker::job::{
    BuildError, CompilationJob, Dataset, EvaluationJob, Language, Testcase, UserTest,
};
use serde_json::json;

/// The object every fixture is the same one of, so the operations name it.
const OBJECT: i64 = 7;
/// The dataset every fixture belongs to.
const DATASET: i64 = 3;
/// The codename of the one testcase the dataset holds.
const TESTCASE: &str = "1.in";
/// The automatic manager the dataset asks for, in the form to be renamed.
const AUTO_MANAGER: &str = "grader.%l";
/// The name that automatic manager takes once the language is known.
const GRADER: &str = "grader.cpp";
/// The manager of the dataset the language reads as a header.
const HEADER: &str = "grader.h";
/// The language the object is submitted under.
const LANGUAGE: &str = "C++ 17";

fn digests(pairs: &[(&str, &str)]) -> DigestMap {
    pairs
        .iter()
        .map(|(name, digest)| ((*name).to_owned(), (*digest).to_owned()))
        .collect()
}

fn operation(kind: OperationKind) -> Operation {
    Operation {
        kind,
        object_id: OBJECT,
        dataset_id: DATASET,
        testcase_codename: None,
        archive_sandbox: false,
    }
}

fn language() -> Language {
    Language {
        source_extension: ".cpp".to_owned(),
        header_extensions: vec![".h".to_owned()],
    }
}

fn dataset() -> Dataset {
    let mut testcases = BTreeMap::new();
    testcases.insert(
        TESTCASE.to_owned(),
        Testcase {
            codename: TESTCASE.to_owned(),
            input: "in".to_owned(),
            output: "out".to_owned(),
        },
    );
    Dataset {
        id: DATASET,
        task_type: "batch".to_owned(),
        task_type_parameters: json!({ "token": "batch" }),
        managers: digests(&[(GRADER, "g"), (HEADER, "h")]),
        auto_managers: Some(vec![AUTO_MANAGER.to_owned()]),
        testcases,
        time_limit: Some(5.0),
        memory_limit: Some(1024),
    }
}

fn user_test() -> UserTest {
    UserTest {
        id: OBJECT,
        language: Some(LANGUAGE.to_owned()),
        language_descriptor: Some(language()),
        files: digests(&[("ut.cpp", "f")]),
        managers: digests(&[("own.cpp", "o")]),
        input: "ut-in".to_owned(),
        result_executables: digests(&[("ut", "e")]),
        multithreaded_sandbox: false,
    }
}

fn compile_user_test(test: &UserTest, dataset: &Dataset) -> CompilationJob {
    CompilationJob::from_user_test(
        &operation(OperationKind::UserTestCompilation),
        test,
        dataset,
    )
    .expect("a user test compilation operation builds a job")
}

fn evaluate_user_test() -> EvaluationJob {
    EvaluationJob::from_user_test(
        &operation(OperationKind::UserTestEvaluation),
        &user_test(),
        &dataset(),
    )
    .expect("a user test evaluation operation builds a job")
}

#[test]
fn a_user_test_compilation_renames_the_automatic_manager_and_adds_the_headers() {
    let job = compile_user_test(&user_test(), &dataset());
    assert_eq!(
        job.managers,
        digests(&[("own.cpp", "o"), (GRADER, "g"), (HEADER, "h")])
    );
    assert!(!job.managers.contains_key(AUTO_MANAGER));
    assert_eq!(job.info, "compile user test 7");
    assert!(!job.multithreaded_sandbox);
}

#[test]
fn a_user_test_compilation_keeps_its_own_manager_of_the_same_name() {
    let mut dataset = dataset();
    dataset.auto_managers = None;
    let mut test = user_test();
    test.managers = digests(&[(GRADER, "mine")]);
    let job = compile_user_test(&test, &dataset);
    assert_eq!(job.managers.get(GRADER), Some(&"mine".to_owned()));
    assert_eq!(job.managers.get(HEADER), Some(&"h".to_owned()));
}

#[test]
fn a_user_test_compilation_of_an_unknown_language_adds_no_header() {
    let mut test = user_test();
    test.language_descriptor = None;
    let mut dataset = dataset();
    dataset.managers = digests(&[("grader.o", "g"), (HEADER, "h")]);
    dataset.auto_managers = Some(vec!["grader.o".to_owned()]);
    let job = compile_user_test(&test, &dataset);
    assert_eq!(
        job.managers,
        digests(&[("own.cpp", "o"), ("grader.o", "g")])
    );
    assert_eq!(job.language, Some(LANGUAGE.to_owned()));
}

#[test]
fn an_automatic_manager_the_dataset_does_not_hold_is_refused_by_name() {
    let mut test = user_test();
    test.language_descriptor = None;
    let error = CompilationJob::from_user_test(
        &operation(OperationKind::UserTestCompilation),
        &test,
        &dataset(),
    )
    .expect_err("an unknown language renames nothing and the dataset holds no such manager");
    assert_eq!(
        error,
        BuildError::UnknownManager {
            name: AUTO_MANAGER.to_owned()
        }
    );
}

#[test]
fn a_user_test_evaluation_asks_for_the_output_and_names_no_output_file() {
    let job = evaluate_user_test();
    assert_eq!(job.managers, digests(&[("own.cpp", "o"), (GRADER, "g")]));
    assert_eq!(job.executables, digests(&[("ut", "e")]));
    assert_eq!(job.input, "ut-in");
    assert_eq!(job.output, None);
    assert_eq!(job.only_execution, Some(true));
    assert_eq!(job.get_output, Some(true));
    assert_eq!(job.info, "evaluate user test 7");
}

#[test]
fn a_user_test_evaluation_stops_on_a_language_the_lookup_does_not_know() {
    let mut test = user_test();
    test.language_descriptor = None;
    let error = EvaluationJob::from_user_test(
        &operation(OperationKind::UserTestEvaluation),
        &test,
        &dataset(),
    )
    .expect_err("this path reads what the lookup returned and cannot do without it");
    assert_eq!(
        error,
        BuildError::UnknownLanguage {
            language: Some(LANGUAGE.to_owned())
        }
    );
}

#[test]
fn a_user_test_evaluation_is_not_built_from_a_user_test_compilation() {
    let error = EvaluationJob::from_user_test(
        &operation(OperationKind::UserTestCompilation),
        &user_test(),
        &dataset(),
    )
    .expect_err("a user test compilation is not a user test evaluation");
    assert_eq!(
        error,
        BuildError::UnexpectedOperation {
            wanted: OperationKind::UserTestEvaluation,
            found: OperationKind::UserTestCompilation
        }
    );
}
