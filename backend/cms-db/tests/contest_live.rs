//! The contest window against a real server.
//!
//! WHY live: the refusals are Postgres `CheckConstraint`s, so the proof that
//! this port refuses exactly what the reference refuses is the server refusing
//! the same `INSERT`. The table is `TEMP`, so a run leaves the scratch database
//! as it found it.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test contest_live

use cms_db::{ContestWindow, Phase};
use sqlx::Row;

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/contest_db.rs"]
mod contest_db;

use contest_db::{at, code_of, insert_window, open, skip, window};

#[tokio::test]
async fn a_stored_window_reads_back_and_phases_as_the_reference_does() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let fixture = window();

    insert_window(connection.connection(), "read-back", &fixture)
        .await
        .expect("the database accepts a valid window");

    let row = sqlx::query(
        "SELECT start, stop, analysis_enabled, analysis_start, analysis_stop \
         FROM contests WHERE name = 'read-back'",
    )
    .fetch_one(connection.connection())
    .await
    .expect("reading the window back");
    let stored = ContestWindow {
        start: row.try_get("start").expect("start timestamp"),
        stop: row.try_get("stop").expect("stop timestamp"),
        analysis_enabled: row.try_get("analysis_enabled").expect("flag"),
        analysis_start: row.try_get("analysis_start").expect("analysis start"),
        analysis_stop: row.try_get("analysis_stop").expect("analysis stop"),
    };

    assert_eq!(stored, fixture);
    assert_eq!(stored.phase(at(8, 59)), Phase::NotStarted);
    assert_eq!(stored.phase(at(9, 0)), Phase::Active);
    assert_eq!(stored.phase(at(12, 0)), Phase::Active);
    assert_eq!(stored.phase(at(12, 1)), Phase::WaitingForAnalysis);
    assert_eq!(stored.phase(at(13, 0)), Phase::Analysis);
    assert_eq!(stored.phase(at(14, 0)), Phase::Analysis);
    assert_eq!(stored.phase(at(14, 1)), Phase::Ended);
}

#[tokio::test]
async fn the_database_refuses_the_window_orderings_the_validator_refuses() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let mut cases = Vec::new();
    let mut backwards = window();
    backwards.stop = at(8, 0);
    cases.push(("stop-before-start", backwards));
    let mut analysis_before_stop = window();
    analysis_before_stop.analysis_start = at(11, 0);
    cases.push(("analysis-before-stop", analysis_before_stop));
    let mut analysis_backwards = window();
    analysis_backwards.analysis_stop = at(12, 30);
    cases.push(("analysis-backwards", analysis_backwards));

    for (name, case) in cases {
        assert!(case.validate().is_err(), "{name} passed the validator");
        let refused = insert_window(connection.connection(), name, &case).await;
        assert_eq!(
            code_of(&refused).as_deref(),
            Some("23514"),
            "the database accepted {name}"
        );
    }
}
