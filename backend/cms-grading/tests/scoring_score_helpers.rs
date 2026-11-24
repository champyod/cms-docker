//! The database records the pure scoring core turns into one score row.

use cms_db::{
    Codename, DatasetId, DatasetRecord, Evaluation, EvaluationOutcome, FeedbackLevel, ScoreMode,
    ScoreRow, SubmissionId, SubmissionResult, Task, TestcaseRecord, TokenRules,
};
use cms_grading::scoring::{score, ScoringError, ScoringInput};

/// The key every fixture row belongs to.
pub const DATASET_ID: DatasetId = DatasetId(9);
pub const SUBMISSION_ID: SubmissionId = SubmissionId(41);
pub const TASK_ID: i32 = 7;

/// A fixed time without a zone, as the score column stores it.
pub const SCORED_AT_SECONDS: f64 = 1_700_000_000.0;

/// One dataset, its task, and a fully evaluated result over two testcases.
pub struct Fixture {
    /// The dataset whose score configuration is read.
    pub dataset: DatasetRecord,
    /// The task whose published precision is read.
    pub task: Task,
    /// The result whose evaluation flag and key are read.
    pub result: SubmissionResult,
    /// One evaluation per testcase, in testcase order.
    pub evaluations: Vec<Evaluation>,
    /// The two testcases the evaluations belong to.
    pub testcases: Vec<TestcaseRecord>,
}

impl Fixture {
    /// A fully evaluated `Sum` or group dataset over `sample-1` and `sample-2`.
    pub fn new(score_type: &str, parameters: &str) -> Self {
        Self {
            dataset: dataset(score_type, parameters),
            task: task(2),
            result: result(true),
            evaluations: vec![evaluation(3, Some("1.0")), evaluation(4, Some("0.5"))],
            testcases: vec![testcase(3, "sample-1", true), testcase(4, "sample-2", true)],
        }
    }

    /// The borrowed input the scoring core accepts.
    pub fn input(&self) -> ScoringInput<'_> {
        ScoringInput {
            dataset: &self.dataset,
            task: &self.task,
            result: &self.result,
            evaluations: &self.evaluations,
            testcases: &self.testcases,
        }
    }

    /// Score the fixture at the fixed timestamp.
    pub fn score(&self) -> Result<ScoreRow, ScoringError> {
        let scored_at =
            cms_db::make_datetime(Some(SCORED_AT_SECONDS)).expect("fixture time is valid");
        score(&self.input(), scored_at)
    }
}

/// One dataset with a time limit and the given score configuration.
fn dataset(score_type: &str, parameters: &str) -> DatasetRecord {
    DatasetRecord {
        id: DATASET_ID,
        task_id: TASK_ID,
        task_type: "Batch".to_string(),
        score_type: score_type.to_string(),
        score_type_parameters: parameters.to_string(),
        time_limit: Some(2.0),
        memory_limit: None,
        is_active: true,
    }
}

/// One task with the given published precision.
fn task(precision: i32) -> Task {
    Task {
        id: TASK_ID,
        name: Codename::parse("sample").expect("fixture name is a codename"),
        title: "Sample".to_string(),
        submission_format: vec!["%l".to_string()],
        primary_statements: Vec::new(),
        allowed_languages: None,
        token: TokenRules::disabled(),
        max_submission_number: None,
        max_user_test_number: None,
        min_submission_interval: None,
        min_user_test_interval: None,
        evaluation_throttle_delay_s: None,
        feedback_level: FeedbackLevel::Restricted,
        score_precision: precision,
        score_mode: ScoreMode::Max,
        active_dataset_id: Some(DATASET_ID),
    }
}

/// One result whose evaluation flag decides whether scoring reads its runs.
fn result(evaluated: bool) -> SubmissionResult {
    SubmissionResult {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        compilation_outcome: None,
        compilation_tries: 0,
        evaluation_outcome: evaluated.then_some(EvaluationOutcome::Ok),
        evaluation_tries: 0,
        score: None,
        score_details: None,
        public_score: None,
        public_score_details: None,
        ranking_score_details: None,
    }
}

/// One testcase with valid fixture digests.
fn testcase(id: i32, codename: &str, is_public: bool) -> TestcaseRecord {
    TestcaseRecord {
        id,
        dataset_id: DATASET_ID.0,
        codename: codename.to_string(),
        is_public,
        input: "0123456789abcdef0123456789abcdef01234567"
            .parse()
            .expect("fixture input is a digest"),
        output: "fedcba9876543210fedcba9876543210fedcba98"
            .parse()
            .expect("fixture output is a digest"),
    }
}

/// One evaluation carrying the grader's outcome and resource measurements.
fn evaluation(testcase_id: i32, outcome: Option<&str>) -> Evaluation {
    Evaluation {
        id: testcase_id,
        submission_id: SUBMISSION_ID.0,
        dataset_id: DATASET_ID.0,
        testcase_id,
        outcome: outcome.map(str::to_string),
        text: vec!["Execution completed successfully".to_string()],
        admin_text: None,
        execution_time: Some(0.25),
        execution_wall_clock_time: None,
        execution_memory: Some(1024),
        evaluation_shard: None,
        evaluation_sandbox_paths: None,
        evaluation_sandbox_digests: None,
    }
}
