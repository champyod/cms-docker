//! The task row and its dataset pointer: both rules live in the schema, not in code.

use cms_db::{
    activate_dataset, dataset_by_id, delete_dataset, unjudged_submissions, DatasetId, Submission,
    TaskError, TokenMode,
};

use super::fixtures::{at, connect, read_task, skip, SILENT};
use crate::rows as judging;

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
