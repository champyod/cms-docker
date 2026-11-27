//! The bound host answers `queue_status` with the reference's empty list.

use cms_svc::Client;
use serde_json::{json, Value};

use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

const SCHEMA: &str = "evaluation_binary_host";
use crate::{
    finish, spawn_with, DATABASE_URL_VARIABLE, PORT_VARIABLE, SECRET, SECRET_VARIABLE,
    SHARD_VARIABLE,
};

#[tokio::test]
async fn the_bound_host_answers_queue_status_and_quit_stops_the_process() {
    let url = std::env::var("CMS_DB_TEST_URL")
        .ok()
        .filter(|url| !url.trim().is_empty())
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database");
    let mut setup = PgConnection::connect(&url)
        .await
        .expect("connecting to the scratch database");
    for statement in [
        format!("DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"),
        format!("CREATE SCHEMA {SCHEMA}"),
    ] {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut setup)
            .await
            .expect("creating the binary test schema");
    }
    let variables = vec![
        (
            DATABASE_URL_VARIABLE,
            format!("{url}?options=-csearch_path%3D{SCHEMA}"),
        ),
        (PORT_VARIABLE, "0".to_owned()),
        (SHARD_VARIABLE, "0".to_owned()),
        (SECRET_VARIABLE, SECRET.to_owned()),
    ];
    let mut running = spawn_with(&variables);
    let address = running.started();
    let mut client = Client::connect(address, Some(SECRET.to_owned()))
        .expect("the reported listener accepts the test client");

    assert_eq!(
        client
            .echo("evaluation host smoke")
            .expect("echo is served"),
        Value::String("evaluation host smoke".to_owned())
    );
    assert_eq!(
        client
            .call("queue_status", json!({}))
            .expect("queue_status is served"),
        Value::Array(Vec::new()),
        "a fresh daemon has no queued operations"
    );
    assert_eq!(
        client
            .call(
                "quit",
                json!({"reason": "evaluation host test complete", "fatal": false}),
            )
            .expect("quit is served"),
        Value::Null
    );

    let output = finish(running);
    assert!(output.status.success(), "quit exits zero: {output:?}");
    let stderr = String::from_utf8(output.stderr).expect("stderr is UTF-8");
    assert!(
        stderr.contains(
            "Trying to exit as asked by another service (evaluation host test complete)."
        ),
        "{stderr}"
    );
}
