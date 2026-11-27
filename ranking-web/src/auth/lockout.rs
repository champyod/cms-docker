use std::time::Duration;

use sha2::{Digest, Sha256};

/// The panel locks an account after five failures for fifteen minutes; the console
/// keeps that policy so an operator learns one set of numbers.
pub const MAX_ATTEMPTS: u32 = 5;
pub const WINDOW: Duration = Duration::from_secs(15 * 60);
/// Usernames longer than this are refused before they can become a Redis key.
pub const MAX_USERNAME_BYTES: usize = 128;

/// The Python contest server keeps its counters under its own namespace, so an
/// unblock here cannot forgive a brute-force run against the contest surface.
pub const NAMESPACE: &str = "cms:ranking:login:";
/// The panel reads this beside a hashed counter to recover the display name.
pub const METADATA_NAMESPACE: &str = "cms:ranking:login-meta:";

/// One key per account and source, and one per source across usernames: an attacker
/// who rotates usernames must not get a fresh counter each time.
pub fn account_key(username: &str, address: &str) -> String {
    format!("{NAMESPACE}{}|{address}", username_digest(username))
}

pub fn address_key(address: &str) -> String {
    format!("{NAMESPACE}ip#{address}")
}

/// The attempt-list namespace. It drops the counter namespace's trailing colon so
/// the key (`cms:ranking:login-attempts:`) falls outside the counter scan
/// (`cms:ranking:login:*`), which would otherwise read a list key as a counter.
pub const ATTEMPTS_NAMESPACE: &str = "cms:ranking:login-attempts:";

/// The attempt list paired with [`account_key`], mirroring the two counter families.
pub fn attempt_account_key(username: &str, address: &str) -> String {
    format!(
        "{ATTEMPTS_NAMESPACE}{}|{address}",
        username_digest(username)
    )
}

pub fn attempt_address_key(address: &str) -> String {
    format!("{ATTEMPTS_NAMESPACE}ip#{address}")
}

/// The metadata key paired with an account counter; address keys have no entry.
pub fn metadata_key_for(counter_key: &str) -> String {
    match counter_key.strip_prefix(NAMESPACE) {
        Some(suffix) => format!("{METADATA_NAMESPACE}{suffix}"),
        None => counter_key.to_string(),
    }
}

pub fn username_within_limit(username: &str) -> bool {
    username.len() <= MAX_USERNAME_BYTES
}

fn username_digest(username: &str) -> String {
    hex::encode(Sha256::digest(username.as_bytes()))
}

/// The attempt list a counter key pairs with, so a clear can forget both together.
pub fn attempt_key_for(counter_key: &str) -> String {
    match counter_key.strip_prefix(NAMESPACE) {
        Some(suffix) => format!("{ATTEMPTS_NAMESPACE}{suffix}"),
        None => counter_key.to_string(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Verdict {
    pub locked: bool,
    pub retry_after_seconds: u64,
}

impl Verdict {
    pub fn allowed() -> Self {
        Self {
            locked: false,
            retry_after_seconds: 0,
        }
    }
}

/// The decision, kept a pure function so it is testable without a store: the count
/// and the remaining window are all the store contributes.
pub fn verdict(account: Option<(u32, Duration)>, address: Option<(u32, Duration)>) -> Verdict {
    let locked_until = [account, address]
        .into_iter()
        .flatten()
        .filter(|(count, _)| *count >= MAX_ATTEMPTS)
        .map(|(_, remaining)| remaining)
        .max();
    match locked_until {
        Some(remaining) => Verdict {
            locked: true,
            retry_after_seconds: remaining.as_secs().max(1),
        },
        None => Verdict::allowed(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keys_carry_the_namespace_and_the_two_families() {
        let account = account_key("u", "1.2.3.4");
        assert!(account.starts_with("cms:ranking:login:"));
        assert!(!account.contains("u|"));
        assert_eq!(
            account
                .trim_start_matches("cms:ranking:login:")
                .split('|')
                .next()
                .expect("digest")
                .len(),
            64
        );
        assert_eq!(address_key("1.2.3.4"), "cms:ranking:login:ip#1.2.3.4");
        assert_eq!(
            metadata_key_for(&account),
            format!(
                "cms:ranking:login-meta:{}",
                account.trim_start_matches("cms:ranking:login:")
            )
        );
    }

    #[test]
    fn a_username_at_the_limit_is_allowed_and_one_byte_over_is_not() {
        assert!(username_within_limit(&"a".repeat(MAX_USERNAME_BYTES)));
        assert!(!username_within_limit(&"a".repeat(MAX_USERNAME_BYTES + 1)));
    }

    #[test]
    fn the_attempt_keys_mirror_the_counters_outside_the_counter_scan() {
        assert_eq!(
            attempt_key_for(&account_key("u", "1.2.3.4")),
            attempt_account_key("u", "1.2.3.4")
        );
        assert_eq!(
            attempt_address_key("1.2.3.4"),
            "cms:ranking:login-attempts:ip#1.2.3.4"
        );
        // A key outside the namespace is left as it is rather than mis-prefixed.
        assert_eq!(attempt_key_for("other:key"), "other:key");
    }

    #[test]
    fn four_failures_still_allow_an_attempt() {
        let verdict = verdict(Some((4, WINDOW)), None);
        assert!(!verdict.locked);
        assert_eq!(verdict.retry_after_seconds, 0);
    }

    #[test]
    fn the_fifth_failure_locks_and_reports_the_window() {
        let verdict = verdict(Some((MAX_ATTEMPTS, Duration::from_secs(600))), None);
        assert!(verdict.locked);
        assert_eq!(verdict.retry_after_seconds, 600);
    }

    #[test]
    fn the_address_family_locks_even_when_the_account_does_not() {
        let verdict = verdict(
            Some((1, WINDOW)),
            Some((MAX_ATTEMPTS, Duration::from_secs(60))),
        );
        assert!(verdict.locked);
        assert_eq!(verdict.retry_after_seconds, 60);
    }

    #[test]
    fn a_lapsed_counter_does_not_lock() {
        assert!(!verdict(None, None).locked);
    }

    #[test]
    fn a_locked_counter_never_reports_zero_seconds() {
        let verdict = verdict(Some((MAX_ATTEMPTS, Duration::from_secs(0))), None);
        assert_eq!(verdict.retry_after_seconds, 1);
    }
}
