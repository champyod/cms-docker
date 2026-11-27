//! Live store test: the chain this crate writes, against a provisioned store.
//!
//! Runs only when `CMS_AUDIT_TEST_CONFIG` is set, so the default test run stays
//! offline. It proves three things a unit test cannot: the writer role really
//! can append, really cannot rewrite what it appended, and the rows it appends
//! verify as a chain when read back from the database.

use chrono::Utc;
use cms_audit::{append_entry, connect, verify_chain, AuditEntry, AuditStoreConfig, StoredRow};

#[tokio::test]
async fn the_writer_appends_a_verifiable_chain_and_cannot_rewrite_it(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut config = match load_config() {
        Ok(config) => config,
        Err(missing) => {
            eprintln!("skipping: {missing}");
            return Ok(());
        }
    };
    if let Ok(ca) = std::env::var("CMS_AUDIT_REQUIRE_CA") {
        config.ca_certificate = Some(std::path::PathBuf::from(ca));
    }
    let pool = connect(&config).await?;

    let mut first = entry("evaluation:create", "41/9/3");
    append_entry(&pool, &mut first).await?;
    let mut second = entry("submissionresult:update", "41/9");
    append_entry(&pool, &mut second).await?;

    assert!(
        second.id > first.id,
        "the second append chains after the first: {} then {}",
        first.id,
        second.id
    );
    assert_eq!(
        second.prev_hash, first.entry_hash,
        "the second row links to the first"
    );
    assert!(first.entry_hash.is_some(), "the chain owns the hash");
    assert!(
        first.prev_hash != second.prev_hash,
        "each row links to its own predecessor"
    );

    let rows = read_chain(&pool, 1).await?;
    let verdict = verify_chain(&rows, &[]);
    assert!(verdict.ok(), "{:?}", verdict.failures);
    assert!(
        verdict.verified >= 2,
        "both rows verified, saw {}",
        verdict.verified
    );

    let update = sqlx::query("UPDATE public.audit_log SET result = 'tampered' WHERE id = $1")
        .bind(first.id)
        .execute(&pool)
        .await;
    assert!(update.is_err(), "writer must not be able to update");

    let delete = sqlx::query("DELETE FROM public.audit_log WHERE id = $1")
        .bind(first.id)
        .execute(&pool)
        .await;
    assert!(delete.is_err(), "writer must not be able to delete");

    Ok(())
}

fn entry(verb: &str, entity_id: &str) -> AuditEntry {
    AuditEntry {
        id: 0,
        actor_id: None,
        timestamp: Utc::now(),
        verb: verb.to_string(),
        entity: "submission_results".to_string(),
        entity_id: Some(entity_id.to_string()),
        before_values: None,
        after_values: Some(serde_json::json!({ "score": 1.0 })),
        reason: Some("judging commit".to_string()),
        ip: None,
        session_id: None,
        result: "ok".to_string(),
        entry_hash: None,
        prev_hash: None,
    }
}

/// Reads every row from `id` onward as the verifier's own input shape.
async fn read_chain(pool: &sqlx::PgPool, id: i64) -> Result<Vec<StoredRow>, sqlx::Error> {
    let rows: Vec<Stored> = sqlx::query_as(
        "SELECT id, actor_id, before_values, after_values, entity, entity_id, ip, reason, \
         result, session_id, verb, entry_hash, prev_hash FROM public.audit_log \
         WHERE id >= $1 ORDER BY id",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Stored::into_row).collect())
}

#[derive(sqlx::FromRow)]
struct Stored {
    id: i64,
    actor_id: Option<i32>,
    before_values: Option<serde_json::Value>,
    after_values: Option<serde_json::Value>,
    entity: String,
    entity_id: Option<String>,
    ip: Option<String>,
    reason: Option<String>,
    result: String,
    session_id: Option<String>,
    verb: String,
    entry_hash: Option<String>,
    prev_hash: Option<String>,
}

impl Stored {
    fn into_row(self) -> StoredRow {
        StoredRow {
            id: self.id,
            payload: cms_audit::chain::AuditPayload {
                actor_id: self.actor_id,
                after_values: self.after_values,
                before_values: self.before_values,
                entity: self.entity,
                entity_id: self.entity_id,
                ip: self.ip,
                reason: self.reason,
                result: self.result,
                session_id: self.session_id,
                verb: self.verb,
            },
            entry_hash: self.entry_hash,
            prev_hash: self.prev_hash,
        }
    }
}

fn load_config() -> Result<AuditStoreConfig, String> {
    let host = require("CMS_AUDIT_TEST_HOST")?;
    let port = require("CMS_AUDIT_TEST_PORT")?
        .parse::<u16>()
        .map_err(|_| "CMS_AUDIT_TEST_PORT is not a valid port".to_string())?;
    Ok(AuditStoreConfig {
        host,
        port,
        database: require("CMS_AUDIT_TEST_DATABASE")?,
        user: require("CMS_AUDIT_TEST_USER")?,
        password: require("CMS_AUDIT_TEST_PASSWORD")?,
        ca_certificate: None,
    })
}

fn require(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} is not set"))
}
