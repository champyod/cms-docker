//! Which names a task row may hold, what each one builds, and which names it may not.
//!
//! The reference's registry is keyed by each task type's class name
//! (`tasktypes/__init__.py:48`), while the same class also publishes a human label shown
//! to users, and for two of the five the two disagree: `OutputOnly` is labelled `Output
//! only` and `TwoSteps` is labelled `Two steps`. A lookup that accepted the label would
//! refuse every task of those two kinds while saying the type does not exist, so the key
//! and the label are asserted together here, in one place and in one assertion each.

use cms_grading::tasktypes::{TaskError, TaskType};
use serde_json::{json, Value};

/// Parameters the named type accepts, which are its own declaration's three, four or one.
fn parameters(key: &str) -> Value {
    match key {
        "Batch" => json!(["alone", ["", ""], "diff"]),
        "BatchAndOutput" => json!(["alone", ["", ""], "diff", "1,2"]),
        "OutputOnly" | "TwoSteps" => json!(["diff"]),
        "Communication" => json!([2, "alone", "std_io"]),
        other => panic!("{other} is not one of the five keys"),
    }
}

/// The task type a key builds, or a panic naming the refusal.
fn built(key: &str) -> TaskType {
    TaskType::of(key, &parameters(key))
        .unwrap_or_else(|error| panic!("{key} is a registry key: {error}"))
}

#[test]
fn each_of_the_five_keys_builds_its_own_variant() {
    assert!(matches!(built("Batch"), TaskType::Batch(_)));
    assert!(matches!(
        built("BatchAndOutput"),
        TaskType::BatchAndOutput(_)
    ));
    assert!(matches!(built("OutputOnly"), TaskType::OutputOnly(_)));
    assert!(matches!(built("TwoSteps"), TaskType::TwoSteps(_)));
    assert!(matches!(built("Communication"), TaskType::Communication(_)));
}

#[test]
fn each_key_and_its_label_are_asserted_together_so_a_swap_reddens() {
    let pinned = [
        ("Batch", "Batch"),
        ("BatchAndOutput", "BatchAndOutput"),
        ("OutputOnly", "Output only"),
        ("TwoSteps", "Two steps"),
        ("Communication", "Communication"),
    ];
    for (key, label) in pinned {
        let task_type = built(key);
        assert_eq!(task_type.registry_key(), key, "the key of the {label} type");
        assert_eq!(task_type.label(), label, "the label of the {key} type");
    }
}

#[test]
fn a_label_is_not_a_registry_key() {
    for label in ["Output only", "Two steps"] {
        let error = TaskType::of(label, &json!(["diff"]))
            .expect_err("a label is what a user reads, not what a column holds");
        assert!(
            matches!(&error, TaskError::UnknownName { name } if name == label),
            "{label} was refused with {error:?}"
        );
    }
}

#[test]
fn a_name_the_registry_does_not_hold_is_refused_by_name() {
    let error = TaskType::of("GroupMax", &json!([10]))
        .expect_err("the registry holds five names and not this one");
    assert!(
        matches!(&error, TaskError::UnknownName { name } if name == "GroupMax"),
        "the refusal names the key: {error:?}"
    );
    assert_eq!(
        error.to_string(),
        "the task type `GroupMax` is not one this worker has"
    );
}

#[test]
fn parameters_are_refused_by_the_named_type_and_not_the_registry() {
    // `gradr` is the misspelling that used to read as "not a grader" and grade without one.
    let refused = TaskType::of("Batch", &json!(["gradr", ["", ""], "diff"]))
        .expect_err("gradr names no compilation choice");
    assert_eq!(
        refused.to_string(),
        "parameter `Compilation` must be one of `alone`, `grader`, not \"gradr\""
    );
    assert!(
        !matches!(refused, TaskError::UnknownName { .. }),
        "the key is a registry entry, so only the parameters can be wrong"
    );
}

/// Parity with the reference: only Communication asks the service for its manager.
#[test]
fn automatic_managers_are_exact_for_all_five_kinds() {
    let pinned: [(&str, &[&str]); 5] = [
        ("Batch", &[]),
        ("BatchAndOutput", &[]),
        ("OutputOnly", &[]),
        ("TwoSteps", &[]),
        ("Communication", &["manager"]),
    ];
    for (key, names) in pinned {
        let expected: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
        assert_eq!(
            built(key).auto_managers(),
            expected,
            "the automatic managers of the {key} type"
        );
    }
}
