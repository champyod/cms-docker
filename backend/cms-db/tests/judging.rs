//! The task and submission rules against a real server.
//!
//! WHY live: a token play is a row the next balance is rebuilt from, a result's
//! status is columns, and the dataset rules are foreign keys — no stand-in carries
//! any of those. The suite runs when `CMS_DB_TEST_URL` names a scratch database.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test judging

use chrono::{DateTime, NaiveDateTime};
use cms_db::{
    accept_token, activate_dataset, dataset_by_id, delete_dataset, unjudged_submissions, DatasetId,
    Submission, SubmissionError, SubmissionStatus, Task, TaskError, TokenBudget, TokenMode,
    TokenRefusal, TokenRules,
};
use sqlx::postgres::PgConnection;

#[path = "support/judging.rs"]
mod judging;

const URL_ENV: &str = "CMS_DB_TEST_URL";

/// The instant every fixture is stamped with.
const START_SECONDS: i64 = 1_700_000_000;

/// The epoch-seconds fixture as the zone-less time the columns hold.
fn at() -> NaiveDateTime {
    DateTime::from_timestamp(START_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}

/// The scratch database's URL, or `None` with the reason printed.
fn skip() -> Option<String> {
    let url = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty());
    if url.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    url
}

async fn connect(url: &str) -> PgConnection {
    judging::open(url)
        .await
        .expect("connecting to the scratch database")
}

/// A task with no tokens, so a fixture that is not about tokens stays silent.
const SILENT: judging::Quota = judging::Quota {
    mode: "disabled",
    gen_initial: 0,
    max_number: None,
};

/// A budget whose contest half never runs out, so the task's quota decides alone.
fn unlimited() -> TokenRules {
    TokenRules {
        mode: TokenMode::Infinite,
        ..TokenRules::disabled()
    }
}

/// The task row this binary owns under `name`, read back from the table.
async fn read_task(connection: &mut PgConnection, task_id: i32) -> Task {
    Task::get(connection, task_id)
        .await
        .expect("reading the task")
        .expect("the task the fixture inserted")
}

#[test]
fn a_task_reads_back_with_the_quota_its_columns_hold() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let id = judging::create_task(
            &mut connection,
            "s3d-task-read",
            judging::Quota {
                mode: "finite",
                gen_initial: 3,
                max_number: Some(5),
            },
        )
        .await;

        let task = read_task(&mut connection, id).await;

        assert_eq!(task.id, id);
        assert_eq!(task.name.as_str(), "s3d-task-read");
        assert_eq!(task.token.mode, TokenMode::Finite);
        assert_eq!(task.token.gen_initial, 3);
        assert_eq!(task.token.max_number, Some(5));
        assert_eq!(task.active_dataset_id, None);
        assert!(task
            .testcases(&mut connection)
            .await
            .expect("testcases")
            .is_empty());
    });
}

#[test]
fn the_testcases_of_the_active_dataset_are_the_ones_the_task_reads() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-task-testcases", SILENT).await;
        let first = judging::create_dataset(&mut connection, task_id, "first").await;
        judging::create_testcase(&mut connection, first, "alpha").await;
        judging::create_testcase(&mut connection, first, "beta").await;
        let second = judging::create_dataset(&mut connection, task_id, "second").await;
        judging::create_testcase(&mut connection, second, "gamma").await;

        activate_dataset(&mut connection, task_id, DatasetId(first))
            .await
            .expect("activating the first dataset");
        let task = read_task(&mut connection, task_id).await;
        let active = task
            .active_dataset(&mut connection)
            .await
            .expect("dataset")
            .expect("the dataset the fixture activated");
        let testcases = task.testcases(&mut connection).await.expect("testcases");

        assert_eq!(active.id, DatasetId(first));
        assert!(active.is_active);
        let codenames: Vec<String> = testcases.iter().map(|case| case.codename.clone()).collect();
        assert_eq!(codenames, ["alpha", "beta"]);

        activate_dataset(&mut connection, task_id, DatasetId(second))
            .await
            .expect("activating the second dataset");
        let task = read_task(&mut connection, task_id).await;
        let testcases = task.testcases(&mut connection).await.expect("testcases");
        assert_eq!(testcases.len(), 1);
        assert_eq!(testcases[0].codename, "gamma");
    });
}

#[test]
fn a_finite_quota_allows_what_it_grants_and_refuses_the_play_after() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(
            &mut connection,
            "s3d-tokens-spent",
            judging::Quota {
                mode: "finite",
                gen_initial: 2,
                max_number: Some(2),
            },
        )
        .await;
        let task = read_task(&mut connection, task_id).await;
        let budget = TokenBudget {
            contest: unlimited(),
            task: task.token,
            start: at(),
        };
        let mut submissions = Vec::new();
        for opaque in 0..3 {
            let id = judging::create_submission(&mut connection, task_id, 501, opaque, at()).await;
            submissions.push(
                Submission::get(&mut connection, cms_db::SubmissionId(id))
                    .await
                    .expect("reading the submission")
                    .expect("the submission the fixture inserted"),
            );
        }

        for submission in &submissions[..2] {
            accept_token(&mut connection, submission, &budget, at())
                .await
                .expect("the first two plays are within the allowance");
        }
        let refused = accept_token(&mut connection, &submissions[2], &budget, at()).await;

        assert!(
            matches!(
                refused,
                Err(SubmissionError::Refused(TokenRefusal::NoTokensAvailable))
            ),
            "a spent quota must refuse, got {refused:?}"
        );
        let played: i64 =
            sqlx::query_scalar("SELECT count(*) FROM tokens t JOIN submissions s ON s.id = t.submission_id WHERE s.participation_id = 501")
                .fetch_one(&mut connection)
                .await
                .expect("counting the plays");
        assert_eq!(played, 2, "a refused play must not write a token row");
    });
}

#[test]
fn a_second_play_on_the_same_submission_is_refused_as_already_played() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(
            &mut connection,
            "s3d-tokens-twice",
            judging::Quota {
                mode: "infinite",
                gen_initial: 0,
                max_number: None,
            },
        )
        .await;
        let task = read_task(&mut connection, task_id).await;
        let budget = TokenBudget {
            contest: unlimited(),
            task: task.token,
            start: at(),
        };
        let id = judging::create_submission(&mut connection, task_id, 502, 0, at()).await;
        let submission = Submission::get(&mut connection, cms_db::SubmissionId(id))
            .await
            .expect("reading the submission")
            .expect("the submission the fixture inserted");

        let first = accept_token(&mut connection, &submission, &budget, at()).await;
        let second = accept_token(&mut connection, &submission, &budget, at()).await;

        assert!(
            first.is_ok(),
            "an unlimited task must accept the first play"
        );
        assert!(matches!(
            second,
            Err(SubmissionError::Refused(TokenRefusal::AlreadyPlayed))
        ));
        assert!(submission.tokened(&mut connection).await.expect("token"));
    });
}

#[test]
fn the_quota_is_consulted_before_the_submissions_own_token() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(
            &mut connection,
            "s3d-tokens-order",
            judging::Quota {
                mode: "finite",
                gen_initial: 1,
                max_number: Some(1),
            },
        )
        .await;
        let task = read_task(&mut connection, task_id).await;
        let budget = TokenBudget {
            contest: unlimited(),
            task: task.token,
            start: at(),
        };
        let id = judging::create_submission(&mut connection, task_id, 503, 0, at()).await;
        let submission = Submission::get(&mut connection, cms_db::SubmissionId(id))
            .await
            .expect("reading the submission")
            .expect("the submission the fixture inserted");

        accept_token(&mut connection, &submission, &budget, at())
            .await
            .expect("the single token the task grants");
        let again = accept_token(&mut connection, &submission, &budget, at()).await;

        assert!(
            matches!(
                again,
                Err(SubmissionError::Refused(TokenRefusal::NoTokensAvailable))
            ),
            "the reference tests the quota first, so a repeated play reports no tokens"
        );
    });
}

#[test]
fn activating_another_dataset_leaves_the_results_on_the_old_one() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-dataset-switch", SILENT).await;
        let first = judging::create_dataset(&mut connection, task_id, "first").await;
        let second = judging::create_dataset(&mut connection, task_id, "second").await;
        let id = judging::create_submission(&mut connection, task_id, 504, 0, at()).await;
        judging::create_result(&mut connection, id, first).await;
        activate_dataset(&mut connection, task_id, DatasetId(first))
            .await
            .expect("activating the first dataset");
        activate_dataset(&mut connection, task_id, DatasetId(second))
            .await
            .expect("activating the second dataset");
        let submission = Submission::get(&mut connection, cms_db::SubmissionId(id))
            .await
            .expect("reading the submission")
            .expect("the submission the fixture inserted");
        let active = submission
            .get_result(&mut connection, None)
            .await
            .expect("result");
        let old = dataset_by_id(&mut connection, DatasetId(first))
            .await
            .expect("reading the old dataset");
        let on_old = submission
            .get_result(&mut connection, old.as_ref())
            .await
            .expect("result on the old dataset");

        assert!(
            active.is_none(),
            "a submission has no result for a dataset it was never judged on"
        );
        assert!(on_old.is_some(), "activation must not move the old result");
        let moved: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM submission_results WHERE submission_id = $1 AND dataset_id <> $2",
        )
        .bind(id)
        .bind(second)
        .fetch_one(&mut connection)
        .await
        .expect("counting the old results");
        assert_eq!(moved, 1);
        let unjudged = unjudged_submissions(&mut connection, task_id, DatasetId(second))
            .await
            .expect("listing the unjudged submissions");
        assert_eq!(unjudged, vec![cms_db::SubmissionId(id)]);
        assert!(
            unjudged_submissions(&mut connection, task_id, DatasetId(first))
                .await
                .expect("listing the judged ones")
                .is_empty()
        );
    });
}

#[test]
fn deleting_a_dataset_takes_the_results_filed_under_it() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id = judging::create_task(&mut connection, "s3d-dataset-delete", SILENT).await;
        let first = judging::create_dataset(&mut connection, task_id, "first").await;
        let second = judging::create_dataset(&mut connection, task_id, "second").await;
        let case = judging::create_testcase(&mut connection, first, "alpha").await;
        let id = judging::create_submission(&mut connection, task_id, 505, 0, at()).await;
        judging::create_result(&mut connection, id, first).await;
        judging::create_evaluation(&mut connection, id, first, case).await;
        activate_dataset(&mut connection, task_id, DatasetId(second))
            .await
            .expect("activating the second dataset");

        let removed = delete_dataset(&mut connection, DatasetId(first))
            .await
            .expect("deleting a dataset nothing points at");

        assert_eq!(removed, 1);
        let results: i64 =
            sqlx::query_scalar("SELECT count(*) FROM submission_results WHERE dataset_id = $1")
                .bind(first)
                .fetch_one(&mut connection)
                .await
                .expect("counting the results");
        let evaluations: i64 =
            sqlx::query_scalar("SELECT count(*) FROM evaluations WHERE dataset_id = $1")
                .bind(first)
                .fetch_one(&mut connection)
                .await
                .expect("counting the evaluations");
        assert_eq!(
            (results, evaluations),
            (0, 0),
            "the key cascades the rows away"
        );
        assert_eq!(
            read_task(&mut connection, task_id).await.active_dataset_id,
            Some(DatasetId(second))
        );
    });
}

#[test]
fn deleting_the_active_dataset_is_refused_by_the_pointer_it_would_null() {
    let Some(url) = skip() else { return };
    sqlx::test_block_on(async {
        let mut connection = connect(&url).await;
        let task_id =
            judging::create_task(&mut connection, "s3d-dataset-delete-active", SILENT).await;
        let active = judging::create_dataset(&mut connection, task_id, "active").await;
        activate_dataset(&mut connection, task_id, DatasetId(active))
            .await
            .expect("activating the dataset");

        let refused = delete_dataset(&mut connection, DatasetId(active)).await;

        assert!(
            matches!(refused, Err(TaskError::Database(_))),
            "the composite key nulls both halves, and the task's id may not be NULL: {refused:?}"
        );
        assert_eq!(
            read_task(&mut connection, task_id).await.active_dataset_id,
            Some(DatasetId(active)),
            "a refused delete must leave the pointer and the dataset alone"
        );
        assert!(dataset_by_id(&mut connection, DatasetId(active))
            .await
            .expect("reading the dataset")
            .is_some());
    });
}

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
