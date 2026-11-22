//! The digest walk over one contest's object graph, as `enumerate_files` makes it.
//!
//! The set dedupes a digest two tables reach, and drops the tombstone because it
//! names no content to keep.

use std::collections::BTreeSet;

use sqlx::postgres::PgConnection;

use crate::contest::Contest;
use crate::digest::FileDigest;

use super::walk::{statement, FileSkips};

/// The digests of every file `contest` references, or of every contest when it is `None`.
///
/// The walk keeps the order of nothing: the reference returns a set too, so a caller
/// that needs an order imposes one.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run, and
/// [`sqlx::Error::ColumnDecode`] naming `digest` for a value the `DIGEST` domain
/// would have refused.
pub async fn enumerate_files(
    connection: &mut PgConnection,
    contest: Option<&Contest>,
    skips: FileSkips,
) -> Result<BTreeSet<FileDigest>, sqlx::Error> {
    let sql = statement(contest.is_some(), skips);
    let mut query = sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(sql));
    if let Some(contest) = contest {
        query = query.bind(contest.id);
    }
    let stored = query.fetch_all(connection).await?;
    let mut digests = BTreeSet::new();
    for text in stored {
        if let Some(digest) = stored_digest(&text)? {
            digests.insert(digest);
        }
    }
    Ok(digests)
}

/// Parses one `DIGEST` column, naming it when the domain refuses the value.
fn stored_digest(text: &str) -> Result<Option<FileDigest>, sqlx::Error> {
    let digest: FileDigest = text.parse().map_err(|source| sqlx::Error::ColumnDecode {
        index: "digest".to_string(),
        source: Box::new(source),
    })?;
    Ok((!digest.is_tombstone()).then_some(digest))
}
