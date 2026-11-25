//! The result row, its status transitions, and the evaluation a testcase run leaves.

use cms_db::{accept_token, DatasetId, Submission, SubmissionError, SubmissionStatus, TokenBudget};

use super::fixtures::{at, connect, read_task, skip, unlimited, SILENT};
use crate::rows as judging;

#[test]
fn a_result_reads_back_with_the_status_its_columns_spell() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-result-status", SILENT).await;
        let dataset = judging::create_dataset(&mut connection, task_id, "only").await;
        let id = judging::create_submission(&mut connection, task_id, 506, 0, at()).await;
        judging::create_result(&mut connection, id, dataset).await;
        let key = (cms_db::SubmissionId(id), DatasetId(dataset));

        let compiled = cms_db::result_by_id(&mut connection, key.0, key.1)
            .await
            .expect("reading the result")
            .expect("the result the fixture inserted");
        assert_eq!(compiled.status(), SubmissionStatus::Evaluating);

        sqlx::query("UPDATE submission_results SET evaluation_outcome = 'ok' WHERE submission_id = $1 AND dataset_id = $2")
            .bind(key.0 .0)
            .bind(key.1 .0)
            .execute(&mut connection)
            .await
            .expect("recording the evaluation outcome");
        let evaluated = cms_db::result_by_id(&mut connection, key.0, key.1)
            .await
            .expect("reading the result")
            .expect("the result");
        assert_eq!(evaluated.status(), SubmissionStatus::Scoring);
        assert!(evaluated.needs_scoring());

        sqlx::query(
            "UPDATE submission_results
             SET score = 100, score_details = '{\"score\": 100}'::jsonb,
                 public_score = 100, public_score_details = '{\"score\": 100}'::jsonb,
                 ranking_score_details = ARRAY['100']
             WHERE submission_id = $1 AND dataset_id = $2",
        )
        .bind(key.0 .0)
        .bind(key.1 .0)
        .execute(&mut connection)
        .await
        .expect("writing the five score fields");
        let scored = cms_db::result_by_id(&mut connection, key.0, key.1)
            .await
            .expect("reading the result")
            .expect("the result");

        assert_eq!(scored.status(), SubmissionStatus::Scored);
        assert_eq!(scored.score_details.as_deref(), Some("{\"score\": 100}"));
        assert!(!scored.needs_scoring());
    });
}

#[test]
fn invalidating_an_evaluation_removes_the_rows_it_named() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-result-invalidate", SILENT).await;
        let dataset = judging::create_dataset(&mut connection, task_id, "only").await;
        let alpha = judging::create_testcase(&mut connection, dataset, "alpha").await;
        let beta = judging::create_testcase(&mut connection, dataset, "beta").await;
        let id = judging::create_submission(&mut connection, task_id, 507, 0, at()).await;
        judging::create_result(&mut connection, id, dataset).await;
        judging::create_executable(&mut connection, id, dataset).await;
        judging::create_evaluation(&mut connection, id, dataset, alpha).await;
        judging::create_evaluation(&mut connection, id, dataset, beta).await;
        let mut result = cms_db::result_by_id(
            &mut connection,
            cms_db::SubmissionId(id),
            DatasetId(dataset),
        )
        .await
        .expect("reading the result")
        .expect("the result");
        result.set_evaluation_outcome();
        result.set_compilation_outcome(true);

        result
            .invalidate_evaluation(&mut connection, Some(alpha))
            .await
            .expect("invalidating one testcase");
        let left: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM evaluations WHERE submission_id = $1 AND dataset_id = $2",
        )
        .bind(id)
        .bind(dataset)
        .fetch_one(&mut connection)
        .await
        .expect("counting the evaluations");

        assert_eq!(left, 1, "only the named testcase's row may go");
        assert_eq!(result.status(), SubmissionStatus::Evaluating);
        assert!(result.evaluation_outcome.is_none() && result.score.is_none());

        result
            .invalidate_compilation(&mut connection)
            .await
            .expect("invalidating the compilation");
        let evaluations: i64 =
            sqlx::query_scalar("SELECT count(*) FROM evaluations WHERE submission_id = $1")
                .bind(id)
                .fetch_one(&mut connection)
                .await
                .expect("counting the evaluations");
        let executables: i64 =
            sqlx::query_scalar("SELECT count(*) FROM executables WHERE submission_id = $1")
                .bind(id)
                .fetch_one(&mut connection)
                .await
                .expect("counting the executables");

        assert_eq!((evaluations, executables), (0, 0));
        assert_eq!(result.status(), SubmissionStatus::Compiling);
    });
}

#[test]
fn the_evaluation_on_a_testcase_reads_back_and_a_foreign_one_is_refused() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-evaluation-read", SILENT).await;
        let dataset = judging::create_dataset(&mut connection, task_id, "only").await;
        let other = judging::create_dataset(&mut connection, task_id, "other").await;
        let alpha = judging::create_testcase(&mut connection, dataset, "alpha").await;
        let foreign = judging::create_testcase(&mut connection, other, "foreign").await;
        let id = judging::create_submission(&mut connection, task_id, 508, 0, at()).await;
        judging::create_result(&mut connection, id, dataset).await;
        judging::create_evaluation(&mut connection, id, dataset, alpha).await;
        let result = cms_db::result_by_id(
            &mut connection,
            cms_db::SubmissionId(id),
            DatasetId(dataset),
        )
        .await
        .expect("reading the result")
        .expect("the result");

        let run = result
            .get_evaluation(&mut connection, &case_record(alpha, dataset))
            .await
            .expect("reading the evaluation")
            .expect("the evaluation the fixture inserted");
        let refused = result
            .get_evaluation(&mut connection, &case_record(foreign, other))
            .await;

        assert_eq!(run.testcase_id, alpha);
        assert_eq!(run.outcome.as_deref(), Some("1.0"));
        assert_eq!(run.execution_time, Some(1.5));
        assert!(matches!(
            refused,
            Err(SubmissionError::TestcaseOfAnotherDataset { .. })
        ));
    });
}

#[test]
fn a_submission_reads_back_with_its_comment_and_its_token() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(
            &mut connection,
            "s3d-submission-read",
            judging::Quota {
                mode: "infinite",
                gen_initial: 0,
                max_number: None,
            },
        )
        .await;
        let id = judging::create_submission(&mut connection, task_id, 509, 7, at()).await;
        sqlx::query("UPDATE submissions SET comment = $1 WHERE id = $2")
            .bind("first line\nsecond line")
            .bind(id)
            .execute(&mut connection)
            .await
            .expect("writing the comment");
        let submission = Submission::get(&mut connection, cms_db::SubmissionId(id))
            .await
            .expect("reading the submission")
            .expect("the submission the fixture inserted");
        let task = read_task(&mut connection, task_id).await;
        let budget = TokenBudget {
            contest: unlimited(),
            task: task.token,
            start: at(),
        };

        assert_eq!(submission.short_comment(), "first line");
        assert_eq!(submission.opaque_id, 7);
        assert!(!submission.tokened(&mut connection).await.expect("token"));

        accept_token(&mut connection, &submission, &budget, at())
            .await
            .expect("playing a token");
        let token = submission
            .token(&mut connection)
            .await
            .expect("token")
            .expect("the token the play wrote");

        assert_eq!(token.submission_id, id);
        assert_eq!(token.timestamp, at());
        assert!(submission.tokened(&mut connection).await.expect("token"));
    });
}

/// The fixture drops and recreates its child tables with the declared foreign
/// keys, so neither accepts a row whose `submission_results` parent is absent.
#[test]
fn fixture_child_tables_reject_a_dangling_result_row() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-fk-dangling", SILENT).await;
        let dataset = judging::create_dataset(&mut connection, task_id, "only").await;
        // A valid testcase keeps the evaluations.testcases FK satisfied, so the
        // only constraint an insert can violate is the parent-result FK.
        let testcase = judging::create_testcase(&mut connection, dataset, "alpha").await;
        // No submission_results row exists for this pair.
        let dangling: i32 = 999_999;

        let executable = sqlx::query(
            "INSERT INTO executables (submission_id, dataset_id, filename, digest)
             VALUES ($1, $2, 'ghost', 'deadbeef')",
        )
        .bind(dangling)
        .bind(dataset)
        .execute(&mut connection)
        .await
        .expect_err("executables accepted a row with no parent submission_results");
        let executable_db = executable
            .as_database_error()
            .expect("executables raised a non-database error");
        assert_eq!(
            executable_db.code().as_deref(),
            Some("23503"),
            "executables did not raise the foreign-key violation"
        );

        let evaluation = sqlx::query(
            "INSERT INTO evaluations (submission_id, dataset_id, testcase_id)
             VALUES ($1, $2, $3)",
        )
        .bind(dangling)
        .bind(dataset)
        .bind(testcase)
        .execute(&mut connection)
        .await
        .expect_err("evaluations accepted a row with no parent submission_results");
        let evaluation_db = evaluation
            .as_database_error()
            .expect("evaluations raised a non-database error");
        assert_eq!(
            evaluation_db.code().as_deref(),
            Some("23503"),
            "evaluations did not raise the foreign-key violation"
        );
    });
}

/// One testcase of `dataset`, carrying the digests the fixture inserts.
fn case_record(id: i32, dataset: i32) -> cms_db::TestcaseRecord {
    cms_db::TestcaseRecord {
        id,
        dataset_id: dataset,
        codename: "alpha".to_string(),
        is_public: false,
        input: "0123456789abcdef0123456789abcdef01234567"
            .parse()
            .expect("a fixture digest"),
        output: "fedcba9876543210fedcba9876543210fedcba98"
            .parse()
            .expect("a fixture digest"),
    }
}
