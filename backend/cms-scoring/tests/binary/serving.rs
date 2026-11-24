use cms_svc::Client;
use serde_json::Value;

use crate::service_db::Fixture;
use crate::{
    finish, spawn_with, DATABASE_URL_VARIABLE, PORT_VARIABLE, SECRET, SECRET_VARIABLE,
    SHARD_VARIABLE,
};

const SCHEMA: &str = "scoring_binary_host";
const URL_ENV: &str = "CMS_DB_TEST_URL";

#[tokio::test]
async fn the_bound_host_echoes_and_quit_stops_the_process() {
    let _fixture = Fixture::required(SCHEMA).await;
    let url = std::env::var(URL_ENV)
        .expect("CMS_DB_TEST_URL names the scratch database used by the fixture");
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
        client.echo("scoring host smoke").expect("echo is served"),
        Value::String("scoring host smoke".to_owned())
    );
    assert_eq!(
        client
            .call(
                "quit",
                serde_json::json!({"reason": "scoring host test complete", "fatal": false}),
            )
            .expect("quit is served"),
        Value::Null
    );

    let output = finish(running);
    assert!(output.status.success(), "quit exits zero: {output:?}");
    let stderr = String::from_utf8(output.stderr).expect("stderr is UTF-8");
    assert!(
        stderr.contains("Trying to exit as asked by another service (scoring host test complete)."),
        "{stderr}"
    );
}
