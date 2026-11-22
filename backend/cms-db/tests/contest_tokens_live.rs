//! The contest token configuration against a real server.
//!
//! WHY live: every refusal is a `CheckConstraint` or the `token_mode` enum, so
//! the server refusing the same row is the proof that the port reproduces the
//! reference. The table is `TEMP`, so a run leaves the scratch database as it
//! found it.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test contest_tokens_live

use cms_db::{Interval, TokenMode, TokenPolicy};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/contest_db.rs"]
mod contest_db;

use contest_db::{code_of, insert_policy, open, policy, skip};

#[tokio::test]
async fn the_database_refuses_the_token_configurations_the_validator_refuses() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let mut cases = Vec::new();
    cases.push((
        "zero-total-cap",
        TokenPolicy {
            max_number: Some(0),
            ..policy()
        },
    ));
    cases.push((
        "negative-min-interval",
        TokenPolicy {
            min_interval: Interval::from_seconds(-1).expect("fixture interval"),
            ..policy()
        },
    ));
    cases.push((
        "negative-initial",
        TokenPolicy {
            gen_initial: -1,
            ..policy()
        },
    ));
    cases.push((
        "negative-generation",
        TokenPolicy {
            gen_number: -1,
            ..policy()
        },
    ));
    cases.push((
        "zero-generation-interval",
        TokenPolicy {
            gen_interval: Interval::zero(),
            ..policy()
        },
    ));
    cases.push((
        "zero-generation-cap",
        TokenPolicy {
            gen_max: Some(0),
            ..policy()
        },
    ));
    cases.push((
        "initial-above-cap",
        TokenPolicy {
            gen_initial: 5,
            gen_max: Some(4),
            ..policy()
        },
    ));

    for (name, case) in cases {
        assert!(case.validate().is_err(), "{name} passed the validator");
        let refused = insert_policy(connection.connection(), name, &case).await;
        assert_eq!(
            code_of(&refused).as_deref(),
            Some("23514"),
            "the database accepted {name}"
        );
    }
}

#[tokio::test]
async fn the_database_refuses_a_mode_outside_the_enum() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    assert!("mixed".parse::<TokenMode>().is_err());
    let refused = sqlx::query(
        "INSERT INTO contests \
         (name, start, stop, analysis_enabled, analysis_start, analysis_stop, token_mode) \
         VALUES ('mixed', timestamp '2026-11-22 09:00', timestamp '2026-11-22 12:00', false, \
                 timestamp '2026-11-22 13:00', timestamp '2026-11-22 14:00', 'mixed')",
    )
    .execute(connection.connection())
    .await;

    assert!(refused.is_err(), "the enum accepted `mixed`");
    assert_eq!(code_of(&refused).as_deref(), Some("22P02"));
}

#[tokio::test]
async fn the_database_accepts_a_valid_finite_policy() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let fixture = policy();

    assert_eq!(fixture.validate(), Ok(()));
    insert_policy(connection.connection(), "finite", &fixture)
        .await
        .expect("the database accepts a valid finite policy");
}

#[tokio::test]
async fn the_database_does_not_bound_an_absent_generation_cap() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let fixture = TokenPolicy {
        gen_initial: 99,
        gen_max: None,
        ..policy()
    };

    assert_eq!(fixture.validate(), Ok(()));
    insert_policy(connection.connection(), "uncapped", &fixture)
        .await
        .expect("a NULL cap makes the check unknown, not false");
}
