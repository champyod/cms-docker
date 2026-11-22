//! The token quota: what it grants, and the two refusals that keep it from granting more.

use cms_db::{accept_token, Submission, SubmissionError, TokenBudget, TokenRefusal};

use super::fixtures::{at, connect, read_task, skip, unlimited};
use crate::rows as judging;

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
