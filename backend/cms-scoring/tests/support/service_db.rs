//! A private PostgreSQL schema and pooled session for scoring service tests.

use chrono::NaiveDateTime;
use cms_db::{DatasetId, ScoringCandidate, Session, SessionConfig, SubmissionId, Transaction};
use sqlx::postgres::PgConnection;
use sqlx::Connection;

pub use crate::service_schema::DATASET_ID;
use crate::service_schema::{self, PARTICIPATION_ID, TASK_ID};

const URL_ENV: &str = "CMS_DB_TEST_URL";

/// The six stored score columns read back after a service transaction.
#[derive(Debug, PartialEq, sqlx::FromRow)]
pub struct StoredScore {
    /// The score the dataset computed.
    pub score: Option<f64>,
    /// The full details document as PostgreSQL renders its JSONB.
    pub score_details: Option<String>,
    /// The instant the scoring pass stamped.
    pub scored_at: Option<NaiveDateTime>,
    /// The score over public testcases.
    pub public_score: Option<f64>,
    /// The public details document as PostgreSQL renders its JSONB.
    pub public_score_details: Option<String>,
    /// The ranking table's extra detail strings.
    pub ranking_score_details: Option<Vec<String>>,
}

/// One test's schema, base rows and pooled session.
pub struct Fixture {
    session: Session,
}

impl Fixture {
    /// Create a fresh schema, or report that no scratch database was configured.
    pub async fn open(schema: &'static str) -> Option<Self> {
        let Some(url) = std::env::var(URL_ENV)
            .ok()
            .filter(|url| !url.trim().is_empty())
        else {
            eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
            return None;
        };
        let mut setup = PgConnection::connect(&url)
            .await
            .expect("connecting to the scratch database");
        service_schema::create(&mut setup, schema).await;
        let config = SessionConfig::new(format!("{url}?options=-csearch_path%3D{schema}"));
        let session = Session::open(&config)
            .await
            .expect("opening the pooled session");
        Some(Self { session })
    }

    /// The session the service transactions use.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// Seed one evaluated result with the two testcase outcomes.
    pub async fn seed_result(
        &self,
        submission: i32,
        timestamp: NaiveDateTime,
        outcomes: [&str; 2],
    ) -> ScoringCandidate {
        let mut transaction = self.session.begin().await.expect("beginning the seed");
        sqlx::query(
            "INSERT INTO submissions
                 (id, opaque_id, participation_id, task_id, timestamp)
             VALUES ($1, $1, $2, $3, $4)",
        )
        .bind(submission)
        .bind(PARTICIPATION_ID)
        .bind(TASK_ID)
        .bind(timestamp)
        .execute(transaction.connection())
        .await
        .expect("seeding the submission");
        sqlx::query(
            "INSERT INTO submission_results
                 (submission_id, dataset_id, compilation_outcome, evaluation_outcome)
             VALUES ($1, $2, 'ok', 'ok')",
        )
        .bind(submission)
        .bind(DATASET_ID)
        .execute(transaction.connection())
        .await
        .expect("seeding the result");
        seed_evaluations(&mut transaction, submission, outcomes).await;
        transaction.commit().await.expect("committing the seed");
        ScoringCandidate {
            submission_id: SubmissionId(submission),
            dataset_id: DatasetId(DATASET_ID),
            timestamp,
        }
    }

    /// Replace both grader outcomes so a second scoring pass has new values.
    pub async fn set_outcomes(&self, submission: i32, outcomes: [&str; 2]) {
        let mut transaction = self.session.begin().await.expect("beginning the update");
        for (testcase, outcome) in [(30, outcomes[0]), (31, outcomes[1])] {
            sqlx::query(
                "UPDATE evaluations SET outcome = $3
                 WHERE submission_id = $1 AND dataset_id = $2 AND testcase_id = $4",
            )
            .bind(submission)
            .bind(DATASET_ID)
            .bind(outcome)
            .bind(testcase)
            .execute(transaction.connection())
            .await
            .expect("updating the evaluation");
        }
        transaction.commit().await.expect("committing the update");
    }

    /// Read every stored score column through the pooled database boundary.
    pub async fn stored_score(&self, submission: i32) -> StoredScore {
        let mut transaction = self.session.begin().await.expect("beginning the read");
        let score = sqlx::query_as::<_, StoredScore>(
            "SELECT score, score_details::text AS score_details, scored_at,
                    public_score, public_score_details::text AS public_score_details,
                    ranking_score_details
             FROM submission_results
             WHERE submission_id = $1 AND dataset_id = $2",
        )
        .bind(submission)
        .bind(DATASET_ID)
        .fetch_one(transaction.connection())
        .await
        .expect("reading the stored score");
        transaction.commit().await.expect("committing the read");
        score
    }
}

async fn seed_evaluations(transaction: &mut Transaction, submission: i32, outcomes: [&str; 2]) {
    for (testcase, outcome) in [(30, outcomes[0]), (31, outcomes[1])] {
        sqlx::query(
            "INSERT INTO evaluations
                 (submission_id, dataset_id, testcase_id, outcome, text,
                  execution_time, execution_memory)
             VALUES ($1, $2, $3, $4, ARRAY['run'], $5, 1024)",
        )
        .bind(submission)
        .bind(DATASET_ID)
        .bind(testcase)
        .bind(outcome)
        .bind(f64::from(testcase - 29) / 4.0)
        .execute(transaction.connection())
        .await
        .expect("seeding the evaluation");
    }
}
