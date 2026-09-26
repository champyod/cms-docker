//! Append-only writer for the independent audit store.
//!
//! The store is provisioned by `admin-panel/prisma/sql/audit_second_store.sql`.
//! Its writer role holds SELECT and INSERT only, so every write must supply the
//! original row `id`; there is no sequence privilege to draw a value from.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};

const MAX_CONNECTIONS: u32 = 5;
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// One audit event, mirroring every column of the provisioned `audit_log`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: i64,
    pub actor_id: Option<i32>,
    pub timestamp: DateTime<Utc>,
    pub verb: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub before_values: Option<Value>,
    pub after_values: Option<Value>,
    pub reason: Option<String>,
    pub ip: Option<String>,
    pub session_id: Option<String>,
    pub result: String,
    pub entry_hash: Option<String>,
    pub prev_hash: Option<String>,
}

/// Connection settings for the audit database. The caller supplies the writer
/// password out of band; it is never read from the process environment here.
#[derive(Debug, Clone)]
pub struct AuditStoreConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub ca_certificate: Option<PathBuf>,
}

impl AuditStoreConfig {
    /// Connection options with certificate and hostname verification forced on.
    ///
    /// Verification is not optional: the writer's grant boundary stops a
    /// compromised CMS from rewriting stored rows, but only an authenticated,
    /// verified channel stops it from reading or replacing the database in
    /// transit. Without an explicit CA the platform trust store is used, so a
    /// private-CA deployment must always supply one.
    pub fn connect_options(&self) -> PgConnectOptions {
        let options = PgConnectOptions::new()
            .host(&self.host)
            .port(self.port)
            .database(&self.database)
            .username(&self.user)
            .password(&self.password)
            .ssl_mode(PgSslMode::VerifyFull);

        match &self.ca_certificate {
            Some(ca_certificate) => options.ssl_root_cert(ca_certificate),
            None => options,
        }
    }
}

/// Open the writer pool. Fails closed: an unverified or unreachable store
/// returns an error rather than silently degrading to an unencrypted channel.
pub async fn connect(config: &AuditStoreConfig) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .idle_timeout(CONNECT_TIMEOUT)
        .connect_with(config.connect_options())
        .await
}

const INSERT_SQL: &str = "INSERT INTO public.audit_log (id, actor_id, timestamp, verb, \
     entity, entity_id, before_values, after_values, reason, ip, session_id, result, \
     entry_hash, prev_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, \
     $13, $14)";

/// Append one event. The store has no UPDATE or DELETE grant, so a successful
/// return means the row is durable and unalterable through this role.
pub async fn insert_entry(pool: &PgPool, entry: &AuditEntry) -> Result<(), sqlx::Error> {
    sqlx::query(INSERT_SQL)
        .bind(entry.id)
        .bind(entry.actor_id)
        .bind(entry.timestamp)
        .bind(&entry.verb)
        .bind(&entry.entity)
        .bind(&entry.entity_id)
        .bind(&entry.before_values)
        .bind(&entry.after_values)
        .bind(&entry.reason)
        .bind(&entry.ip)
        .bind(&entry.session_id)
        .bind(&entry.result)
        .bind(&entry.entry_hash)
        .bind(&entry.prev_hash)
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::ConnectOptions;

    #[test]
    fn audit_entry_round_trips_through_json() -> Result<(), serde_json::Error> {
        let entry = sample_entry();
        let encoded = serde_json::to_string(&entry)?;
        let decoded: AuditEntry = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, entry);
        Ok(())
    }

    #[test]
    fn audit_entry_keeps_integers_exact() -> Result<(), serde_json::Error> {
        let entry = sample_entry();
        let encoded = serde_json::to_string(&entry)?;
        assert!(encoded.contains("\"id\":9001"), "{encoded}");
        Ok(())
    }

    #[test]
    fn connect_options_force_full_tls_verification() {
        let rendered = sample_config().connect_options().to_url_lossy().to_string();
        assert!(rendered.contains("sslmode=verify-full"), "{rendered}");
    }

    #[test]
    fn connect_options_carry_the_supplied_writer_identity() {
        let rendered = sample_config().connect_options().to_url_lossy().to_string();
        assert!(rendered.contains("cms_audit"), "{rendered}");
    }

    fn sample_entry() -> AuditEntry {
        AuditEntry {
            id: 9001,
            actor_id: Some(7),
            timestamp: DateTime::UNIX_EPOCH,
            verb: "delete".to_string(),
            entity: "submissions".to_string(),
            entity_id: Some("42".to_string()),
            before_values: Some(serde_json::json!({"id": 42})),
            after_values: None,
            reason: Some("retained".to_string()),
            ip: None,
            session_id: None,
            result: "ok".to_string(),
            entry_hash: Some("abc".to_string()),
            prev_hash: None,
        }
    }

    fn sample_config() -> AuditStoreConfig {
        AuditStoreConfig {
            host: "audit.example".to_string(),
            port: 5432,
            database: "cms_audit".to_string(),
            user: "cms_audit_writer".to_string(),
            password: "unused-in-test".to_string(),
            ca_certificate: None,
        }
    }
}
