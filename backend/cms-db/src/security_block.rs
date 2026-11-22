//! The security block ledger: one ban or lockout per row.
//!
//! `src/cms/db/security_block.py:35-56` maps `security_blocks`, a table the
//! admin panel's Prisma migration creates and the web servers append to. The
//! panel's lockout list reads it, so the row is the only thing that makes a
//! counted lockout visible to an operator.
//!
//! The identity a row is keyed on is `(kind, ip, subject)`, and a repeated block
//! with the same identity closes the still-active one first, so the ledger never
//! holds two active rows for one banned account and address
//! (`security_block.py:36-41`). That ordering belongs to the writer that inserts
//! the row; the declaration here is the table it writes.

use chrono::NaiveDateTime;

use crate::base::{Column, ColumnKind, Declaration};

/// The `security_blocks` table (`src/cms/db/security_block.py:43-56`).
pub const SECURITY_BLOCK: Declaration = Declaration {
    table: "security_blocks",
    columns: &[
        Column::key("id", ColumnKind::BigInteger),
        Column::required("kind", ColumnKind::Text),
        Column::required("source", ColumnKind::Text),
        Column::optional("ip", ColumnKind::Text),
        Column::optional("subject", ColumnKind::Text),
        Column::optional("detail", ColumnKind::Jsonb),
        Column::generated("started_at", ColumnKind::Timestamp),
        Column::optional("expires_at", ColumnKind::Timestamp),
        Column::optional("ended_at", ColumnKind::Timestamp),
        Column::optional("ended_by", ColumnKind::Integer),
        Column::generated("active", ColumnKind::Boolean),
        Column::generated("created_at", ColumnKind::Timestamp),
    ],
    relationships: &[],
};

/// A row of `security_blocks`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityBlock {
    /// `security_blocks.id`, a `bigint` the table fills.
    pub id: i64,
    /// `security_blocks.kind`, the sort of block this is.
    pub kind: String,
    /// `security_blocks.source`, which server wrote the row.
    pub source: String,
    /// `security_blocks.ip`, the address the block covers.
    pub ip: Option<String>,
    /// `security_blocks.subject`, the account the block covers.
    pub subject: Option<String>,
    /// `security_blocks.detail`, the `jsonb` payload as text.
    pub detail: Option<String>,
    /// `security_blocks.started_at`.
    pub started_at: NaiveDateTime,
    /// `security_blocks.expires_at`, absent for a block with no end.
    pub expires_at: Option<NaiveDateTime>,
    /// `security_blocks.ended_at`, absent while the block is still active.
    pub ended_at: Option<NaiveDateTime>,
    /// `security_blocks.ended_by`, the admin who lifted it.
    pub ended_by: Option<i32>,
    /// `security_blocks.active`.
    pub active: bool,
    /// `security_blocks.created_at`.
    pub created_at: NaiveDateTime,
}

impl SecurityBlock {
    /// The identity the ledger keys a block on: the kind, the address, the account.
    ///
    /// A writer looks for an active row with the same triple before it inserts,
    /// which is what keeps two active blocks from covering one account.
    #[must_use]
    pub fn identity(&self) -> (&str, Option<&str>, Option<&str>) {
        (&self.kind, self.ip.as_deref(), self.subject.as_deref())
    }
}
