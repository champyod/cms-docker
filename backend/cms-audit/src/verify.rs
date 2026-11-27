//! Reading a log back and proving it is the chain it claims to be.
//!
//! A writer that chains rows is only half of tamper evidence: without a check
//! that recomputes every hash and every link, an altered or dropped row reads
//! exactly like an original one. This module is that check, and it takes the
//! stored rows rather than a pool so it can be run over a log read from
//! anywhere.

use crate::chain;

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
    use crate::chain;

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
