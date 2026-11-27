//! A private schema, a shared session and the rows one operation reads.

use std::sync::Arc;

use cms_db::{Session, SessionConfig};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

pub use crate::schema::{
    create, digest, schema_name, CONTEST, DATASET, PARTICIPATION, SUBMISSION, TASK, TESTCASE,
    USER_TEST,
};

/// The secret shared by the scripted worker and the evaluation daemon.
pub const SECRET: &str = "operation test secret";

const URL_ENV: &str = "CMS_DB_TEST_URL";
const LIVE_REQUIRED: &str = "CMS_DB_TEST_URL must name a scratch PostgreSQL database";

/// One test's session and the URL the daemon binary can be pointed at.
pub struct Fixture {
    session: Arc<Session>,
    #[allow(dead_code)]
    url: String,
    /// This fixture's private schema; a sibling test has its own.
    schema: String,
}

impl Fixture {
    /// Creates a fresh schema and refuses to run when no scratch URL is set.
    pub async fn required() -> Self {
        let url = std::env::var(URL_ENV)
            .ok()
            .filter(|url| !url.trim().is_empty())
            .expect(LIVE_REQUIRED);
        let schema = schema_name();
        let mut setup = PgConnection::connect(&url)
            .await
            .expect("connecting to the scratch database");
        create(&mut setup, &schema).await;
        seed(&mut setup).await;
        let url = format!("{url}?options=-csearch_path%3D{schema}");
        let session = Arc::new(
            Session::open(&SessionConfig::new(url.clone()))
                .await
                .expect("opening the pooled session"),
        );
        Self {
            session,
            url,
            schema,
        }
    }

    /// The session the RPC context and the worker share.
    pub fn session(&self) -> Arc<Session> {
        Arc::clone(&self.session)
    }

    /// This fixture's schema, so a test's own connection selects it.
    pub fn schema(&self) -> &str {
        &self.schema
    }

    /// The URL with the test schema selected, for a daemon under test.
    #[allow(dead_code)]
    pub fn url(&self) -> &str {
        &self.url
    }
}

/// Seeds the one contest, task, submission, testcase and user test the tests use.
pub async fn seed(connection: &mut PgConnection) {
    for statement in seed_statements() {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut *connection)
            .await
            .expect("seeding an operation row");
    }
}

/// Every row the operation tests read, in foreign-key order.
fn seed_statements() -> Vec<String> {
    let mut statements = vec![
        format!("INSERT INTO contests (id, languages) VALUES ({CONTEST}, ARRAY['C++17'])"),
        format!(
            "INSERT INTO tasks (id, name, active_dataset_id) VALUES ({TASK}, 'task', {DATASET})"
        ),
        format!("INSERT INTO contest_tasks (contest_id, task_id) VALUES ({CONTEST}, {TASK})"),
        format!("INSERT INTO participations (id, contest_id) VALUES ({PARTICIPATION}, {CONTEST})"),
        format!(
            "INSERT INTO datasets (id, task_id, description, task_type, task_type_parameters) \
             VALUES ({DATASET}, {TASK}, 'dataset', 'Batch', \
             '[\"alone\", [\"\", \"\"], \"diff\"]')"
        ),
    ];
    statements.extend(testcase_statements());
    statements.extend(submission_statements());
    statements.extend(user_test_statements());
    statements
}

/// The submission, its upload, the dataset's manager and its executable.
fn submission_statements() -> Vec<String> {
    vec![
        format!(
            "INSERT INTO submissions (id, opaque_id, participation_id, task_id, language) \
             VALUES ({SUBMISSION}, 1, {PARTICIPATION}, {TASK}, 'C++17')"
        ),
        format!(
            "INSERT INTO files (submission_id, filename, digest) VALUES \
             ({SUBMISSION}, 'solution.cpp', '{d5}')",
            d5 = digest(5)
        ),
        format!(
            "INSERT INTO managers (dataset_id, filename, digest) VALUES \
             ({DATASET}, 'checker', '{d6}')",
            d6 = digest(6)
        ),
        format!(
            "INSERT INTO executables (submission_id, dataset_id, filename, digest) VALUES \
             ({SUBMISSION}, {DATASET}, 'solution', '{d7}')",
            d7 = digest(7)
        ),
    ]
}

/// The user test and its uploaded input.
fn user_test_statements() -> Vec<String> {
    vec![
        format!(
            "INSERT INTO user_tests (id, participation_id, task_id, language, input) \
             VALUES ({USER_TEST}, {PARTICIPATION}, {TASK}, 'C++17', '{d8}')",
            d8 = digest(8)
        ),
        format!(
            "INSERT INTO user_test_files (user_test_id, filename, digest) VALUES \
             ({USER_TEST}, 'ut.cpp', '{d9}')",
            d9 = digest(9)
        ),
    ]
}

/// The dataset's two testcases, whose codenames the mapper translates.
fn testcase_statements() -> Vec<String> {
    vec![format!(
        "INSERT INTO testcases (id, dataset_id, codename, input, output) VALUES \
         ({TESTCASE}, {DATASET}, 'alpha', '{d1}', '{d2}'), \
         ({other}, {DATASET}, 'beta', '{d3}', '{d4}')",
        other = TESTCASE + 1,
        d1 = digest(1),
        d2 = digest(2),
        d3 = digest(3),
        d4 = digest(4),
    )]
}
