//! The dataset parameters against a real server: both read paths carry the
//! exact `jsonb` text PostgreSQL renders, not a second parse of the row.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test reads_dataset_params_live

use cms_db::{dataset_by_id, get_datasets_to_judge, DatasetId, Task};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{open, TASK};

/// A dataset id no other fixture uses.
const DATASET: i32 = 9000;

/// A JSON object with nested values, unsorted keys and whitespace: the input
/// PostgreSQL normalises before the query's `::text` cast renders it.
const PARAMETERS_JSON: &str = r#"{ "z": 1, "nested": { "b": [true, null, {"deep": 3}], "a": "x" }, "arr": [1, 2.50, "s"], "spaced" : "a b" }"#;

/// Insert a dataset whose task-type parameters are a nontrivial nested object.
/// The JSON is a SQL literal; its own braces and quotes carry no `$1` meaning.
async fn insert(connection: &mut PgConnection) {
    sqlx::query(AssertSqlSafe(format!(
        "INSERT INTO datasets (id, task_id, task_type_parameters, autojudge) \
         VALUES ({DATASET}, {TASK}, '{PARAMETERS_JSON}'::jsonb, true)"
    )))
    .execute(connection)
    .await
    .expect("inserting the nested dataset");
}

/// What PostgreSQL itself renders for the stored `jsonb`, read without going
/// through `DatasetRecord`: the independent oracle both paths are checked against.
async fn rendered_by_postgres(connection: &mut PgConnection) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT task_type_parameters::text FROM datasets WHERE id = 9000",
    )
    .fetch_one(connection)
    .await
    .expect("reading the stored jsonb text")
}

#[tokio::test]
async fn dataset_task_type_parameters_round_trip_as_raw_json_text() {
    // A live read must fail by name when the URL is absent, never silently skip.
    let url = std::env::var("CMS_DB_TEST_URL").expect(
        "CMS_DB_TEST_URL must name a scratch PostgreSQL database for the dataset parameter read",
    );
    let mut connection = open(&url).await;
    insert(&mut connection).await;

    // PostgreSQL's own ::text is the oracle: differ from the raw input, then
    // both record paths must equal it exactly.
    let rendered = rendered_by_postgres(&mut connection).await;
    assert_ne!(
        rendered, PARAMETERS_JSON,
        "the stored jsonb was not normalised"
    );

    // Path one: one dataset by id (DATASET_BY_ID).
    let by_id = dataset_by_id(&mut connection, DatasetId(DATASET))
        .await
        .expect("reading the dataset by id")
        .expect("the dataset the fixture inserted");
    assert_eq!(
        by_id.task_type_parameters, rendered,
        "DATASET_BY_ID lost the raw jsonb text"
    );

    // Path two: the judgeable datasets (JUDGEABLE_DATASETS).
    let task = Task::get(&mut connection, TASK)
        .await
        .expect("reading the task")
        .expect("the task the fixture seeded");
    let judgeable = get_datasets_to_judge(&mut connection, &task)
        .await
        .expect("reading the judgeable datasets");
    let judged = judgeable
        .iter()
        .find(|dataset| dataset.id.0 == DATASET)
        .expect("the autojudge dataset is judgeable");
    assert_eq!(
        judged.task_type_parameters, rendered,
        "JUDGEABLE_DATASETS lost the raw jsonb text"
    );
}
