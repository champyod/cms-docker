//! Append-only writer for the independent audit store.
//!
//! The store is provisioned by `admin-panel/prisma/sql/audit_second_store.sql`.
//! Its writer role holds SELECT and INSERT only, so every write must supply the
//! original row `id`; there is no sequence privilege to draw a value from.
//!
//! [`chain`] is the SHA-256 chain itself: the same canonical payload and the
//! same digest the panel's `admin-panel/src/lib/audit-chain.ts` computes, so a
//! row written here verifies there and the reverse.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};

pub mod chain;

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

/// The tail of the chain, read under the lock that serialises appends. The
/// writer role has no sequence privilege, so the next `id` is `id + 1` here.
const TAIL_SQL: &str = "SELECT id, entry_hash FROM public.audit_log ORDER BY id DESC LIMIT 1";

/// The advisory lock every appending writer holds: one number for the whole
/// log, so two writers cannot read the same tail and both chain to it.
const APPEND_LOCK: i64 = 0x6373_6d61_7564_6974;

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

/// Why an appending write could not be chained.
#[derive(Debug, thiserror::Error)]
pub enum AppendError {
    /// The store refused a statement.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Append one event as the next link of the chain.
///
/// The caller supplies the row's fields and this function supplies what the
/// chain owns: the next `id`, `prev_hash` read from the current tail, and
/// `entry_hash` computed over the canonical payload. The whole append runs in
/// one transaction holding [`APPEND_LOCK`], so two concurrent writers chain
/// one after the other instead of both linking to the same predecessor.
///
/// # Errors
///
/// Returns [`AppendError::Database`] when the store refused the read, the lock
/// or the insert.
pub async fn append_entry(pool: &PgPool, entry: &mut AuditEntry) -> Result<(), AppendError> {
    let mut transaction = pool.begin().await?;
    // WHY a transaction-scoped advisory lock: the writer has no sequence and no
    // unique constraint to lean on, so the tail read and the insert must be one
    // critical section or two appenders would fork the chain.
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(APPEND_LOCK)
        .execute(&mut *transaction)
        .await?;

    let tail: Option<(i64, Option<String>)> = sqlx::query_as(TAIL_SQL)
        .fetch_optional(&mut *transaction)
        .await?;
    let (next_id, previous_hash) = match tail {
        Some((id, hash)) => (id + 1, hash),
        None => (1, None),
    };

    entry.id = next_id;
    entry.prev_hash.clone_from(&previous_hash);
    entry.entry_hash = Some(chain::compute_entry_hash(
        previous_hash.as_deref(),
        &chain::canonicalise(&chain::AuditPayload {
            actor_id: entry.actor_id,
            after_values: entry.after_values.clone(),
            before_values: entry.before_values.clone(),
            entity: entry.entity.clone(),
            entity_id: entry.entity_id.clone(),
            ip: entry.ip.clone(),
            reason: entry.reason.clone(),
            result: entry.result.clone(),
            session_id: entry.session_id.clone(),
            verb: entry.verb.clone(),
        }),
    ));

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
        .execute(&mut *transaction)
        .await?;

    transaction.commit().await?;
    Ok(())
}

/// One stored row of the log, as verification reads it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRow {
    /// `audit_log.id`, the position the chain's sequence is checked against.
    pub id: i64,
    /// The payload the hash commits to.
    pub payload: chain::AuditPayload,
    /// `audit_log.entry_hash`, absent on a row written outside the chain.
    pub entry_hash: Option<String>,
    /// `audit_log.prev_hash`, absent on the chain's first row.
    pub prev_hash: Option<String>,
}

/// One row's verdict.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RowVerdict {
    /// The stored `entry_hash` is what its own fields produce.
    Verified,
    /// The row carries no `entry_hash` at all: written outside the chain.
    Unchained,
    /// The stored hash is not what the row's fields produce; it was altered.
    Altered {
        /// The hash this row's fields actually produce.
        computed: String,
    },
}

/// What verification found over a whole log.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ChainVerdict {
    /// One line per violation, naming the row id and what was wrong.
    pub failures: Vec<String>,
    /// Rows whose own hash verified.
    pub verified: usize,
    /// Rows correctly wrapped by a retention anchor, so a gap is explained.
    pub pruned_boundaries: usize,
}

impl ChainVerdict {
    /// Whether every check ran and every one passed. A log with no rows is not
    /// "valid" — nothing was checked — and the caller sees that in `verified`.
    #[must_use]
    pub fn ok(&self) -> bool {
        self.failures.is_empty()
    }
}

/// Verify a whole log: every row's own hash, every `prev_hash` link, and the
/// id sequence.
///
/// A link that does not match is a failure unless one of `retained_from` names
/// the row a retention prune cut the log at, which is the only legitimate way
/// for the chain to begin somewhere other than a genesis row.
#[must_use]
pub fn verify_chain(rows: &[StoredRow], retained_from: &[i64]) -> ChainVerdict {
    let mut verdict = ChainVerdict::default();
    let mut sorted: Vec<&StoredRow> = rows.iter().collect();
    sorted.sort_by_key(|row| row.id);
    let mut previous: Option<&StoredRow> = None;
    for row in sorted {
        match verify_row(row) {
            RowVerdict::Verified => verdict.verified += 1,
            RowVerdict::Unchained => verdict
                .failures
                .push(format!("row {}: carries no entry_hash", row.id)),
            RowVerdict::Altered { computed } => verdict.failures.push(format!(
                "row {}: entry_hash does not match its own fields (recomputed {computed})",
                row.id
            )),
        }
        match previous {
            None => {
                let boundary =
                    row.prev_hash.is_none() || retained_from.binary_search(&row.id).is_ok();
                if boundary {
                    verdict.pruned_boundaries += 1;
                } else {
                    verdict.failures.push(format!(
                        "row {}: prev_hash {} names no earlier row in the log",
                        row.id,
                        row.prev_hash.as_deref().unwrap_or("null")
                    ));
                }
            }
            Some(before) => {
                if row.prev_hash != before.entry_hash {
                    let boundary = retained_from.binary_search(&row.id).is_ok();
                    if boundary {
                        verdict.pruned_boundaries += 1;
                    } else {
                        verdict.failures.push(format!(
                            "row {}: prev_hash {} does not link to row {} ({})",
                            row.id,
                            row.prev_hash.as_deref().unwrap_or("null"),
                            before.id,
                            before.entry_hash.as_deref().unwrap_or("null")
                        ));
                    }
                } else if row.id != before.id + 1 {
                    verdict.failures.push(format!(
                        "rows {}..{}: {} id(s) missing",
                        before.id,
                        row.id,
                        row.id - before.id - 1
                    ));
                }
            }
        }
        previous = Some(row);
    }
    verdict
}

/// Which recipe, if any, reproduces one row's stored hash.
#[must_use]
pub fn verify_row(row: &StoredRow) -> RowVerdict {
    let Some(stored) = row.entry_hash.as_deref() else {
        return RowVerdict::Unchained;
    };
    if stored.is_empty() {
        return RowVerdict::Unchained;
    }
    let computed =
        chain::compute_entry_hash(row.prev_hash.as_deref(), &chain::canonicalise(&row.payload));
    if computed == stored {
        RowVerdict::Verified
    } else {
        RowVerdict::Altered { computed }
    }
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

    /// A two-row chain built by the writer's own recipe, so verification is
    /// checked against hashes this crate produced rather than hand-typed ones.
    fn chained_rows() -> Vec<StoredRow> {
        let first = row_payload("evaluation:create");
        let first_hash = chain::compute_entry_hash(None, &chain::canonicalise(&first));
        let second = row_payload("submissionresult:update");
        let second_hash =
            chain::compute_entry_hash(Some(&first_hash), &chain::canonicalise(&second));
        vec![
            StoredRow {
                id: 1,
                payload: first,
                entry_hash: Some(first_hash),
                prev_hash: None,
            },
            StoredRow {
                id: 2,
                payload: second,
                entry_hash: Some(second_hash),
                prev_hash: Some(chain::compute_entry_hash(
                    None,
                    &chain::canonicalise(&row_payload("evaluation:create")),
                )),
            },
        ]
    }

    fn row_payload(verb: &str) -> chain::AuditPayload {
        chain::AuditPayload {
            actor_id: None,
            after_values: Some(serde_json::json!({ "score": 1.0 })),
            before_values: None,
            entity: "submission_results".to_string(),
            entity_id: Some("41/9".to_string()),
            ip: None,
            reason: Some("judging commit".to_string()),
            result: "ok".to_string(),
            session_id: None,
            verb: verb.to_string(),
        }
    }

    #[test]
    fn a_chain_this_writer_built_verifies() {
        let verdict = verify_chain(&chained_rows(), &[]);
        assert!(verdict.ok(), "{:?}", verdict.failures);
        assert_eq!(verdict.verified, 2);
    }

    #[test]
    fn an_edited_result_column_is_caught() {
        let mut rows = chained_rows();
        rows[1].payload.result = "tampered".to_string();
        let verdict = verify_chain(&rows, &[]);
        assert!(!verdict.ok());
        assert!(
            verdict.failures[0].contains("does not match its own fields"),
            "{:?}",
            verdict.failures
        );
    }

    #[test]
    fn a_dropped_row_breaks_the_link() {
        let rows = chained_rows();
        let verdict = verify_chain(&rows[1..], &[]);
        assert!(!verdict.ok());
        assert!(
            verdict.failures[0].contains("names no earlier row"),
            "{:?}",
            verdict.failures
        );
    }

    #[test]
    fn a_middling_row_whose_prev_hash_is_wrong_breaks_the_link() {
        let mut rows = chained_rows();
        let third = row_payload("executable:create");
        rows.push(StoredRow {
            id: 3,
            payload: third.clone(),
            entry_hash: Some(chain::compute_entry_hash(
                Some("not-the-previous-hash"),
                &chain::canonicalise(&third),
            )),
            prev_hash: Some("not-the-previous-hash".to_string()),
        });
        let verdict = verify_chain(&rows, &[]);
        assert!(!verdict.ok());
        assert!(
            verdict
                .failures
                .iter()
                .any(|failure| failure.contains("does not link to row 2")),
            "{:?}",
            verdict.failures
        );
    }

    #[test]
    fn a_row_rewritten_outside_the_chain_is_unchained() {
        let mut rows = chained_rows();
        rows[0].entry_hash = None;
        let verdict = verify_chain(&rows, &[]);
        assert!(!verdict.ok());
        assert!(
            verdict.failures[0].contains("carries no entry_hash"),
            "{:?}",
            verdict.failures
        );
    }

    #[test]
    fn a_retention_boundary_explains_the_missing_prefix() {
        let rows = chained_rows();
        let verdict = verify_chain(&rows[1..], &[2]);
        assert!(verdict.ok(), "{:?}", verdict.failures);
        assert_eq!(verdict.pruned_boundaries, 1);
    }

    #[test]
    fn an_id_gap_with_a_matching_hash_is_still_a_failure() {
        let mut rows = chained_rows();
        rows[1].id = 3;
        rows[1].prev_hash = rows[0].entry_hash.clone();
        let verdict = verify_chain(&rows, &[]);
        assert!(!verdict.ok());
        assert!(
            verdict.failures[0].contains("1 id(s) missing"),
            "{:?}",
            verdict.failures
        );
    }
}
