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
//! [`make_datetime`] and [`make_timestamp`] sit outside the table because a
//! timestamp column's rule is a convention rather than a check: the value is a
//! zone-less UTC spelling, and the two functions are the only pair that reads
//! or writes it. The module docs state the convention and why it is not the
//! machine's zone.
//!
//! `cmscommon`'s security-bearing half is here too, because these are the
//! functions that produce what those columns hold: [`bin_to_hex`] and
//! [`bin_to_b64`] with their readers, SHA-1 through [`Digester`] and
//! [`path_digest`], the AES-CBC [`encrypt_binary`] and [`encrypt_number`] that
//! guard stored secrets and submission tokens, and [`hash_password`] /
//! [`build_password`] for the `admins.authentication` row above. The cipher is
//! the Python side's construction byte for byte — the `crypto` module says why
//! that is not negotiable here.
//!
//! # Errors
//!
//! Every fallible mapping returns the error type named beside it, and each
//! variant says which reference rule it enforces. No mapping degrades to a
//! default on bad input.
//!
//! The identity half of the layer sits here too: [`validate_actor`] is the shape
//! the row-level security policies can read, [`CORE_ACTOR`] is what a core
//! program announces when nothing overrides it, and those two stamp statements
//! are the only place `cms.actor` is written. [`Session::begin`] is the only way
//! to obtain a transaction, so no transaction can begin unstamped.
//!
//! [`Declaration`] is the other half of the model contract: a struct holds the
//! values, and the declaration beside it states which columns exist, which Rust
//! type each one holds, and which of them are keys rather than values.
//!
//! Which contest a service instance serves is resolved here as well:
//! [`contest_binding`] puts an explicit `-c` override in front of the registry
//! row the instance's own entry names, and the deployment default behind both.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod actor;
mod admin;
mod auth;
mod base;
mod binary;
mod binding;
mod codename;
mod contest;
mod crypto;
mod datetime;
mod digest;
mod drop;
mod filecache;
mod fsobject;
mod grants;
mod interval;
mod large_object;
mod permission;
mod reads;
mod security_block;
mod session;
mod submission;
mod task;
mod token_mode;
mod types;
mod user;
mod username;
mod usertest;
mod writes;

pub use actor::{
    default_actor, label_for, process_label, validate_actor, ActorError, ACTOR_ENV, ACTOR_SETTING,
    CONNECTION_STAMP_SQL, CORE_ACTOR, KNOWN_SYSTEM_ACTORS, TRANSACTION_STAMP_SQL,
};
pub use admin::{Admin, ADMIN};
pub use base::{ArrayItem, Column, ColumnKind, Declaration, DeclarationError};
pub use binary::{b64_to_bin, bin_to_b64, bin_to_hex, hex_to_bin, BinaryError};
pub use binding::{
    active_contest, active_contest_id, bootstrap_contest_id, contest_binding, service_binding,
    BindingError, ContestOverride, ServiceBinding, ACTIVE_CONTEST, CONTEST_ID_ENV, NO_OVERRIDE,
    SERVICE, SERVICE_BINDING,
};
pub use codename::{Codename, CodenameError};
pub use contest::{
    Contest, ContestError, ContestWindow, Phase, TokenConfigError, TokenPolicy, WindowError,
    CONTEST,
};
pub use crypto::{
    build_password, decrypt_binary, decrypt_number, encrypt_binary, encrypt_number,
    generate_random_password, get_hex_random_key, get_random_key, hash_password, Bcrypt,
    CryptoError, BCRYPT_MAX_PASSWORD_BYTES, BCRYPT_ROUNDS, BLOCK_BYTES, KEY_BYTES,
    PASSWORD_LETTERS,
};
pub use datetime::{make_datetime, make_timestamp, DateTimeError, EPOCH, LOCAL_TZ, UTC};
pub use digest::{bytes_digest, path_digest, Digester, DEFAULT_READ_BUFFER};
pub use drop::{drop_db, DropError};
pub use filecache::{
    Backend, CacheScope, DbBackend, FileCache, FileCacheConfig, FileCacheError, FsBackend,
    NullBackend, Readable, StoredFile, Writable, CHUNK_SIZE,
};
pub use fsobject::{
    FSObject, FsObjectError, DELETE_FSOBJECT, DELETE_FSOBJECTS, FSOBJECTS, FSOBJECT_BY_DIGEST,
    FSOBJECT_DECLARATION, INSERT_FSOBJECT, NO_LARGE_OBJECT,
};
pub use grants::{
    effective_permissions, PermissionError, ADMIN_ENABLED, ADMIN_GROUP, ADMIN_PERMISSION_OVERRIDE,
    ALLOW_OVERRIDE_KEYS, DENY_OVERRIDE_KEYS, GROUP, GROUP_GRANT_KEYS, GROUP_PERMISSION, PERMISSION,
    REGISTERED_KEYS,
};
pub use large_object::{LargeObject, LargeObjectError, Mode};
pub use reads::{
    dataset_from_row, result_from_row, submission_from_row, testcase_from_row, DatasetId,
    DatasetRecord, ReadError, ResultRecord, SubmissionId, SubmissionRecord, TestcaseRecord,
    DATASET_BY_ID, RESULT_BY_SUBMISSION_AND_DATASET, SUBMISSION_BY_ID, TESTCASES_BY_DATASET,
};
pub use security_block::{SecurityBlock, SECURITY_BLOCK};
pub use session::{
    DedicatedConnection, Session, SessionConfig, SessionError, Transaction, UnhonouredOption,
};
pub use submission::{
    accept_token, max_resources, result_by_id, token_of, Evaluation, Submission, SubmissionError,
    SubmissionResult, SubmissionStatus, Token, TokenBudget, TokenRefusal, DELETE_EVALUATIONS,
    DELETE_EXECUTABLES, EVALUATION, EVALUATIONS_BY_RESULT, EVALUATION_BY_TESTCASE, INSERT_TOKEN,
    SUBMISSION, SUBMISSION_JUDGING_BY_ID, TOKEN, TOKEN_BY_SUBMISSION, TOKEN_HISTORY,
};
pub use task::{
    activate_dataset, dataset_by_id, delete_dataset, merge, unjudged_submissions, FeedbackLevel,
    Playable, ScoreMode, Task, TaskError, TokenRules, Tokens, ACTIVATE_DATASET, DELETE_DATASET,
    SUBMISSIONS_WITHOUT_RESULT, TASK, TASK_BY_ID,
};
pub use token_mode::{TokenGrant, TokenMode, TokenModeError};
pub use types::{
    resolve, AuthError, BcryptPassword, BcryptVerifier, CacheError, CacheHandle, DigestError,
    Effect, EffectivePermissions, FileDigest, Interval, IntervalError, PasswordForm,
    PermissionInputs, PlaintextPassword, RemoveAction, DIGEST_HEX_LEN, MICROS_PER_DAY,
    MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_SECOND, TOMBSTONE, WILDCARD_PERMISSION,
};
pub use user::{Participation, User, PARTICIPATION, USER};
pub use username::{
    resolve_config, ConfigInputs, Policy, CONTESTANT_GROUP, CONTESTANT_GROUP_MEMBERSHIP,
    CONTEST_USERNAME, CONTEST_USERNAME_HISTORY, USERNAME_POLICY,
};
pub use usertest::{
    Filename, FilenameError, FilenameSchema, ReferentialError, ResultKey, UserTest,
    UserTestExecutable, UserTestFile, UserTestFiles, UserTestManager, UserTestManagers,
    UserTestResult, UserTestResults, UserTestStatus, USER_TEST, USER_TEST_EXECUTABLE,
    USER_TEST_FILE, USER_TEST_MANAGER, USER_TEST_RESULT,
};
pub use writes::{
    group_by_object, AuditRow, CompilationOutcome, EvaluationOutcome, EvaluationRow, ExecutableRow,
    ObjectWrite, OperationType, ResultRow, RowState, ScoreRow, WriteError, INSERT_EVALUATIONS,
    INSERT_EXECUTABLES, UPSERT_RESULT, UPSERT_SCORE,
};
