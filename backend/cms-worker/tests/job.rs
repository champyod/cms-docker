//! The two submission paths, and the refusals every constructor begins with.
//!
//! The fixtures are the records the constructors read and nothing else: no task
//! type is instantiated and no sandbox exists, so every difference between the
//! paths is decided by the records handed in.

use std::collections::BTreeMap;

use cms_proto::{DigestMap, Operation, OperationKind};
use cms_worker::job::{
    BuildError, CompilationJob, Dataset, EvaluationJob, Language, Submission, Testcase,
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

fn submission() -> Submission {
    Submission {
        id: OBJECT,
        language: Some(LANGUAGE.to_owned()),
        language_descriptor: Some(language()),
        files: digests(&[("sol.cpp", "f")]),
        result_executables: digests(&[("sol", "e")]),
        multithreaded_sandbox: true,
    }
}

fn compile_submission() -> CompilationJob {
    CompilationJob::from_submission(
        &operation(OperationKind::Compilation),
        &submission(),
        &dataset(),
    )
    .expect("a compilation operation for the submission builds a job")
}

fn evaluate_submission() -> EvaluationJob {
    let mut operation = operation(OperationKind::Evaluation);
    operation.testcase_codename = Some(TESTCASE.to_owned());
    EvaluationJob::from_submission(&operation, &submission(), &dataset())
        .expect("an evaluation naming a testcase the dataset holds builds a job")
}

#[test]
fn a_submission_compilation_takes_the_dataset_managers_verbatim() {
    let job = compile_submission();
    assert_eq!(job.managers, dataset().managers);
    assert!(!job.managers.contains_key(AUTO_MANAGER));
    assert_eq!(job.info, "compile submission 7");
}

#[test]
fn a_submission_evaluation_takes_them_verbatim_as_well() {
    assert_eq!(evaluate_submission().managers, dataset().managers);
}

#[test]
fn the_dataset_names_the_task_type_and_the_object_names_the_files() {
    let job = compile_submission();
    assert_eq!(job.task_type, "batch");
    assert_eq!(job.task_type_parameters, json!({ "token": "batch" }));
    assert_eq!(job.files, digests(&[("sol.cpp", "f")]));
    assert_eq!(job.language, Some(LANGUAGE.to_owned()));
}

#[test]
fn the_multithreaded_flag_comes_from_the_object_and_the_archive_flag_from_the_operation() {
    let mut operation = operation(OperationKind::Compilation);
    operation.archive_sandbox = true;
    let job = CompilationJob::from_submission(&operation, &submission(), &dataset())
        .expect("both flags are read, one off the object and one off the operation");
    assert!(job.multithreaded_sandbox);
    assert!(job.archive_sandbox);
}

#[test]
fn a_submission_evaluation_runs_on_the_testcase_the_operation_names() {
    let job = evaluate_submission();
    assert_eq!(job.input, "in");
    assert_eq!(job.output, Some("out".to_owned()));
    assert_eq!(job.executables, digests(&[("sol", "e")]));
    assert_eq!(job.time_limit, Some(5.0));
    assert_eq!(job.memory_limit, Some(1024));
    assert_eq!(job.only_execution, None);
    assert_eq!(job.get_output, None);
    assert_eq!(job.info, "evaluate submission 7 on testcase 1.in");
}

#[test]
fn an_evaluation_of_a_testcase_the_dataset_does_not_hold_is_refused() {
    let mut operation = operation(OperationKind::Evaluation);
    operation.testcase_codename = Some("2.in".to_owned());
    let error = EvaluationJob::from_submission(&operation, &submission(), &dataset())
        .expect_err("the dataset holds no 2.in");
    assert_eq!(
        error,
        BuildError::UnknownTestcase {
            codename: Some("2.in".to_owned())
        }
    );
    operation.testcase_codename = None;
    let error = EvaluationJob::from_submission(&operation, &submission(), &dataset())
        .expect_err("an evaluation names a testcase");
    assert_eq!(error, BuildError::UnknownTestcase { codename: None });
}

#[test]
fn a_constructor_refuses_an_operation_for_another_object_or_dataset() {
    let mut other = operation(OperationKind::Compilation);
    other.object_id = 8;
    let error = CompilationJob::from_submission(&other, &submission(), &dataset())
        .expect_err("the operation names another object");
    assert_eq!(
        error,
        BuildError::ObjectMismatch {
            operation: 8,
            object: OBJECT
        }
    );
    other.object_id = OBJECT;
    other.dataset_id = 4;
    let error = CompilationJob::from_submission(&other, &submission(), &dataset())
        .expect_err("the operation names another dataset");
    assert_eq!(
        error,
        BuildError::DatasetMismatch {
            operation: 4,
            dataset: DATASET
        }
    );
}

#[test]
fn a_compilation_is_not_built_from_an_evaluation() {
    let error = CompilationJob::from_submission(
        &operation(OperationKind::Evaluation),
        &submission(),
        &dataset(),
    )
    .expect_err("an evaluation is not a compilation");
    assert_eq!(
        error,
        BuildError::UnexpectedOperation {
            wanted: OperationKind::Compilation,
            found: OperationKind::Evaluation
        }
    );
}
