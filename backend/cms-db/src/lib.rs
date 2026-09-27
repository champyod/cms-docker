//! Column-level type mapping for the contest database.
//!
//! The four mapping families behind the `types` module turn the shapes the rest
//! of CMS already exchanges into Rust values that carry the rule their column
//! enforces, so that a row the database would have refused never reaches a
//! query:
//!
//! | Rust type | Postgres column | Reference it reproduces |
//! |---|---|---|
//! | [`Interval`] | `interval` | `cms.db.types` mapping `Interval` to `timedelta` |
//! | [`FileDigest`] | `varchar` under the `DIGEST` domain | `cms.db.types.Digest` |
//! | [`CacheHandle`] | `varchar` under the `DIGEST` domain | `cms.db.filecacher.FileCacher` |
//! | [`PasswordForm`] | `varchar` on `admins.authentication` | `cmscommon.crypto.parse_authentication` |
//! | [`PermissionInputs`] | `groups` / `admin_permission_overrides` | `get_effective_permissions` |
//!
//! Each mapping carries the reference's own acceptance rule rather than a
//! looser one, so a value the database would have refused is refused here too
//! instead of reaching a query.
//!
//! [`Interval`] is the only mapping the driver carries, and the only one that
//! declares `Type`, `Encode` and `Decode`: an `interval` is the one column here
//! that is not text, so the driver's own text wrapper does not apply to it. The
//! other four apply their rule and hand the caller the value as a string, which
//! makes them validation only until the query step that reads and writes their
//! columns binds them.
//!
//! Nothing here opens a connection. The `interval` tests check the driver's own
//! encoder and decoder against the sixteen bytes and the text a column really
//! holds, and the rest check the values their columns hold.
//!
//! # Errors
//!
//! Every fallible mapping returns the error type named beside it, and each
//! variant says which reference rule it enforces. No mapping degrades to a
//! default on bad input.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod auth;
mod digest;
mod interval;
mod permission;
mod reads;
mod types;
mod writes;

pub use reads::{
    dataset_from_row, result_from_row, submission_from_row, testcase_from_row, DatasetRecord,
    ReadError, ResultRecord, SubmissionRecord, TestcaseRecord, DATASET_BY_ID,
    RESULT_BY_SUBMISSION_AND_DATASET, SUBMISSION_BY_ID, TESTCASES_BY_DATASET,
};
pub use types::{
    resolve, AuthError, BcryptPassword, BcryptVerifier, CacheError, CacheHandle, DigestError,
    Effect, EffectivePermissions, FileDigest, Interval, IntervalError, PasswordForm,
    PermissionInputs, PlaintextPassword, RemoveAction, DIGEST_HEX_LEN, MICROS_PER_DAY,
    MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_SECOND, TOMBSTONE, WILDCARD_PERMISSION,
};
pub use writes::{
    group_by_object, AuditRow, CompilationOutcome, EvaluationOutcome, EvaluationRow, ExecutableRow,
    ObjectWrite, OperationType, ResultRow, RowState, ScoreRow, WriteError, INSERT_EVALUATIONS,
    INSERT_EXECUTABLES, UPSERT_RESULT, UPSERT_SCORE,
};
