//! Live store test. Runs only when `CMS_AUDIT_TEST_CONFIG` is set, so the
//! default test run stays offline.

use chrono::Utc;
use cms_audit::{connect, insert_entry, AuditEntry, AuditStoreConfig};

#[tokio::test]
async fn writer_appends_a_row_and_cannot_modify_one() -> Result<(), Box<dyn std::error::Error>> {
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

    let entry = AuditEntry {
        id: 900_001,
        actor_id: Some(7),
        timestamp: Utc::now(),
        verb: "delete".to_string(),
        entity: "submissions".to_string(),
        entity_id: Some("42".to_string()),
        before_values: Some(serde_json::json!({ "id": 42 })),
        after_values: None,
        reason: Some("retained".to_string()),
        ip: None,
        session_id: None,
        result: "ok".to_string(),
        entry_hash: Some("abc".to_string()),
        prev_hash: None,
    };

    insert_entry(&pool, &entry).await?;

    let stored: (i64, String) =
        sqlx::query_as("SELECT id, result FROM public.audit_log WHERE id = $1")
            .bind(entry.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(stored, (entry.id, "ok".to_string()));

    let update = sqlx::query("UPDATE public.audit_log SET result = 'tampered' WHERE id = $1")
        .bind(entry.id)
        .execute(&pool)
        .await;
    assert!(update.is_err(), "writer must not be able to update");

    Ok(())
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
