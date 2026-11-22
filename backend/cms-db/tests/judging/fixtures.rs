//! The setup every live judging test shares: the URL, the connection, and a task read back.

use chrono::{DateTime, NaiveDateTime};
use cms_db::{Task, TokenMode, TokenRules};
use sqlx::postgres::PgConnection;

use crate::rows::Quota;
use crate::schema;

const URL_ENV: &str = "CMS_DB_TEST_URL";

/// The instant every fixture is stamped with.
const START_SECONDS: i64 = 1_700_000_000;

/// The epoch-seconds fixture as the zone-less time the columns hold.
pub fn at() -> NaiveDateTime {
    DateTime::from_timestamp(START_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}

/// The scratch database's URL, or `None` with the reason printed.
pub fn skip() -> Option<String> {
    let url = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty());
    if url.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    url
}

/// A connection to the scratch database, with the judging schema in place.
pub async fn connect(url: &str) -> PgConnection {
    schema::open(url)
        .await
        .expect("connecting to the scratch database")
}

/// The task row this binary owns under `name`, read back from the table.
pub async fn read_task(connection: &mut PgConnection, task_id: i32) -> Task {
    Task::get(connection, task_id)
        .await
        .expect("reading the task")
        .expect("the task the fixture inserted")
}

/// A task with no tokens, so a fixture that is not about tokens stays silent.
pub const SILENT: Quota = Quota {
    mode: "disabled",
    gen_initial: 0,
    max_number: None,
};

/// A budget whose contest half never runs out, so the task's quota decides alone.
pub fn unlimited() -> TokenRules {
    TokenRules {
        mode: TokenMode::Infinite,
        ..TokenRules::disabled()
    }
}
