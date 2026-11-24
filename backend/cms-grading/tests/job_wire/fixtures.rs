use cms_proto::{Operation, OperationKind};
use serde_json::Value;

const COMPILATION: &str = r#"{
  "operation": {"type": "compile", "object_id": 42, "dataset_id": 7,
    "testcase_codename": null, "archive_sandbox": false},
  "task_type": "Batch", "task_type_parameters": {"compilation": "grader"},
  "language": "C++17", "multithreaded_sandbox": false, "archive_sandbox": false,
  "shard": 3, "keep_sandbox": false, "sandboxes": [], "sandbox_digests": {},
  "info": "Compilation", "success": null, "text": null, "admin_text": null,
  "files": {"foo.cpp": "1111111111111111111111111111111111111111"},
  "managers": {"grader.cpp": "2222222222222222222222222222222222222222"},
  "executables": null, "type": "compilation", "compilation_success": null, "plus": null
}"#;

const EVALUATION: &str = r#"{
  "operation": {"type": "evaluate", "object_id": 42, "dataset_id": 7,
    "testcase_codename": "001", "archive_sandbox": false},
  "task_type": "Batch", "task_type_parameters": {"evaluation": "grader"},
  "language": "C++17", "multithreaded_sandbox": false, "archive_sandbox": false,
  "shard": 3, "keep_sandbox": false, "sandboxes": [], "sandbox_digests": {},
  "info": "Evaluation", "success": null, "text": null, "admin_text": null,
  "files": {"foo.cpp": "1111111111111111111111111111111111111111"},
  "managers": {"grader.cpp": "2222222222222222222222222222222222222222"},
  "executables": {"foo": "3333333333333333333333333333333333333333"},
  "type": "evaluation", "input": "4444444444444444444444444444444444444444",
  "output": "5555555555555555555555555555555555555555", "time_limit": 2.0,
  "memory_limit": 262144, "outcome": null, "user_output": null, "plus": null,
  "only_execution": false, "get_output": false
}"#;

pub(crate) fn compilation_body() -> Value {
    serde_json::from_str(COMPILATION).expect("the reference compilation literal is JSON")
}

pub(crate) fn evaluation_body() -> Value {
    serde_json::from_str(EVALUATION).expect("the reference evaluation literal is JSON")
}

pub(crate) fn compilation_operation() -> Operation {
    Operation {
        kind: OperationKind::Compilation,
        object_id: 42,
        dataset_id: 7,
        testcase_codename: None,
        archive_sandbox: false,
    }
}

pub(crate) fn evaluation_operation() -> Operation {
    Operation {
        kind: OperationKind::Evaluation,
        object_id: 42,
        dataset_id: 7,
        testcase_codename: Some("001".to_owned()),
        archive_sandbox: false,
    }
}

pub(crate) fn digests(pairs: &[(&str, &str)]) -> cms_proto::DigestMap {
    pairs
        .iter()
        .map(|(name, digest)| ((*name).to_owned(), (*digest).to_owned()))
        .collect()
}
