//! What each task type refuses about a parameter *value*, at the moment it is built.
//!
//! The reference validates every configured value against the parameter type declared for
//! it (`tasktypes/abc.py:105-126`), which is what stops a malformed dataset from grading
//! as though it were configured as something else: a `compilation` of `gradr` used to read
//! as "not a grader" and quietly grade a subtask without its grader. Every test here is a
//! claim about one declaration and the value it refuses, and none of them needs a box,
//! because the refusal happens before any work is done.
//!
//! The one rule no shipped declaration can pin is the choice's text comparison: a choice
//! among two names cannot tell a number from its spelling, so that rule is pinned where it
//! is implemented, in `parameters/declared.rs`.

use cms_grading::tasktypes::{
    Accepts, Batch, BatchAndOutput, Communication, OutputOnly, TaskError, TwoSteps,
};
use serde_json::json;

/// The name of the parameter a task type refused, what it accepts, and the value it
/// refused, which is what an administrator needs to correct the row.
fn refused<T: std::fmt::Debug>(result: Result<T, TaskError>) -> (String, Accepts, String) {
    match result {
        Err(TaskError::Parameter {
            name,
            accepts,
            value,
        }) => (name.to_owned(), accepts, value.to_string()),
        other => panic!("expected a refused parameter, got {other:?}"),
    }
}

#[test]
fn a_compilation_no_task_type_names_is_refused_at_construction() {
    let (name, accepts, value) = refused(Batch::new(&json!(["gradr", ["", ""], "diff"])));
    assert_eq!(name, "Compilation");
    assert_eq!(accepts.to_string(), "must be one of `alone`, `grader`");
    assert_eq!(value, "\"gradr\"");

    // The two task types compile for different choices, and each refuses the other's.
    let (name, accepts, _) = refused(Communication::new(&json!([1, "grader", "std_io"])));
    assert_eq!(name, "Compilation");
    assert_eq!(accepts.to_string(), "must be one of `alone`, `stub`");

    let (name, accepts, _) = refused(OutputOnly::new(&json!(["compar"])));
    assert_eq!(name, "Output evaluation");
    assert_eq!(accepts.to_string(), "must be one of `diff`, `comparator`");

    let error = Batch::new(&json!(["gradr", ["", ""], "diff"])).expect_err("gradr names no choice");
    assert_eq!(
        error.to_string(),
        "parameter `Compilation` must be one of `alone`, `grader`, not \"gradr\""
    );

    // Case matters, so a misspelling names no choice instead of reading as "not a grader".
    assert!(Batch::new(&json!(["Grader", ["", ""], "diff"])).is_err());
    assert!(Batch::new(&json!(["grader", ["", ""], "diff"]))
        .expect("grader is a choice")
        .uses_grader());
}

#[test]
fn a_value_that_is_not_a_string_is_refused_where_a_string_is_declared() {
    let (name, accepts, value) =
        refused(BatchAndOutput::new(&json!(["alone", ["", ""], "diff", 4])));
    assert_eq!(name, "Comma-separated list of output only testcases");
    assert_eq!(accepts, Accepts::Text);
    assert_eq!(value, "4");

    let (name, accepts, _) = refused(Batch::new(&json!(["alone", ["", 4], "diff"])));
    assert_eq!(name, "Output file");
    assert_eq!(accepts, Accepts::Text);
}

#[test]
fn a_value_that_is_not_an_integer_is_refused_where_an_integer_is_declared() {
    for wrong in [json!("2"), json!(true), json!(1.5), json!(-1), json!(null)] {
        let (name, accepts, value) = refused(Communication::new(&json!([wrong, "stub", "std_io"])));
        assert_eq!(name, "Number of Processes", "{value} is not a count");
        assert_eq!(accepts, Accepts::Integer);
    }

    assert!(
        Communication::new(&json!([2, "stub", "std_io"])).is_ok(),
        "a count of two is a count"
    );
}

#[test]
fn a_collection_of_the_wrong_length_is_refused() {
    for wrong in [
        json!(["alone", [""], "diff"]),
        json!(["alone", ["", "", ""], "diff"]),
        json!(["alone", "in.txt", "diff"]),
    ] {
        let (name, accepts, _) = refused(Batch::new(&wrong));
        assert_eq!(
            name, "I/O (blank for stdin/stdout)",
            "{wrong} is not a pair"
        );
        assert_eq!(accepts.to_string(), "must be a list of 2 parameters");
    }
}

#[test]
fn a_collection_element_of_the_wrong_type_is_refused_by_its_own_name() {
    let (name, accepts, value) = refused(Batch::new(&json!(["alone", [4, ""], "diff"])));
    assert_eq!(name, "Input file");
    assert_eq!(accepts, Accepts::Text);
    assert_eq!(value, "4");

    let (name, _, _) = refused(Batch::new(&json!(["alone", ["", 4], "diff"])));
    assert_eq!(
        name, "Output file",
        "the element is named, not the pair that holds it"
    );
}

#[test]
fn every_task_type_is_still_built_from_a_valid_configuration() {
    let batch = Batch::new(&json!(["alone", ["", ""], "diff"])).expect("a Batch task");
    assert!(!batch.uses_grader() && !batch.uses_comparator());
    assert_eq!(
        (batch.actual_input(), batch.actual_output()),
        ("input.txt", "output.txt")
    );

    let mixed = BatchAndOutput::new(&json!(["alone", ["", ""], "diff", ""]))
        .expect("a BatchAndOutput task");
    assert!(!mixed.batch().uses_comparator() && !mixed.is_output_only("1.in"));

    let output_only = OutputOnly::new(&json!(["comparator"])).expect("an OutputOnly task");
    assert!(output_only.uses_comparator());

    let two_steps = TwoSteps::new(&json!(["diff"])).expect("a Two Steps task");
    assert!(!two_steps.uses_comparator());

    let communication =
        Communication::new(&json!([1, "alone", "std_io"])).expect("a Communication task");
    assert_eq!(communication.processes(), 1);
}
