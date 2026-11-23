//! Which admin may call which RPC — the check between a logged-in admin and a service kill.
//!
//! The decision takes a resolved permission set, so every tier rule is decided with no database; the reads that produce the set are one thin function, and every failure there refuses.
//! `all:all` is matched by membership in the resolved set, which keeps every superadmin in the widest tier.
//! `shard` is accepted because the wire carries it, and no rule here reads it.
//!
//! `submissions_status` is the count behind the dashboard's gauge: one query over the submissions in scope,
//! and the reconciliation that reports a submission no bucket classified as compiling rather than losing it.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod allowlist;
mod policy;
mod read;
mod status;

pub use allowlist::{
    allows, has_messaging, tier_for, Rpc, Tier, RPCS_ALLOWED_FOR_ALL_ADDITIONS,
    RPCS_ALLOWED_FOR_AUTHENTICATED, RPCS_ALLOWED_FOR_MESSAGING_ADDITIONS,
};
pub use policy::{permits, verdict, Access, AccessError};
pub use read::{authorize, load_access, rpc_authorization_checker};
pub use status::{submissions_status, StatusCounts};
