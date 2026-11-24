use cms_db::{DatasetId, Evaluation, SubmissionId, SubmissionResult, UserTestResult};

pub(super) fn submission_result() -> SubmissionResult {
    SubmissionResult::new(SubmissionId(11), DatasetId(22))
}

pub(super) fn user_test_result() -> UserTestResult {
    UserTestResult::new(33, 22)
}

pub(super) fn evaluation(testcase_id: i32) -> Evaluation {
    Evaluation {
        id: testcase_id,
        submission_id: 11,
        dataset_id: 22,
        testcase_id,
        outcome: None,
        text: Vec::new(),
        admin_text: None,
        execution_time: None,
        execution_wall_clock_time: None,
        execution_memory: None,
        evaluation_shard: None,
        evaluation_sandbox_paths: None,
        evaluation_sandbox_digests: None,
    }
}
