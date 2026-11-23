//! Which admin may call which RPC — the check between a logged-in admin and a service kill.
//!
//! The three tiers are declared as deltas so no tier is a hand-copy of another, and the widest is tested first because that order is the policy.
//! `all:all` is matched by membership in the resolved set, which keeps every superadmin in the widest tier.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod allowlist;

pub use allowlist::{
    allows, has_messaging, tier_for, Rpc, Tier, RPCS_ALLOWED_FOR_ALL_ADDITIONS,
    RPCS_ALLOWED_FOR_AUTHENTICATED, RPCS_ALLOWED_FOR_MESSAGING_ADDITIONS,
};
