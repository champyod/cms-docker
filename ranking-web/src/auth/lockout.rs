use std::time::Duration;

/// The panel locks an account after five failures for fifteen minutes; the console
/// keeps that policy so an operator learns one set of numbers.
pub const MAX_ATTEMPTS: u32 = 5;
pub const WINDOW: Duration = Duration::from_secs(15 * 60);

/// The Python contest server keeps its counters under its own namespace, so an
/// unblock here cannot forgive a brute-force run against the contest surface.
pub const NAMESPACE: &str = "cms:ranking:login:";

/// One key per account and source, and one per source across usernames: an attacker
/// who rotates usernames must not get a fresh counter each time.
pub fn account_key(username: &str, address: &str) -> String {
    format!("{NAMESPACE}{username}|{address}")
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
    format!("{ATTEMPTS_NAMESPACE}{username}|{address}")
}

pub fn attempt_address_key(address: &str) -> String {
    format!("{ATTEMPTS_NAMESPACE}ip#{address}")
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
        assert_eq!(account_key("u", "1.2.3.4"), "cms:ranking:login:u|1.2.3.4");
        assert_eq!(address_key("1.2.3.4"), "cms:ranking:login:ip#1.2.3.4");
    }

    #[test]
    fn the_attempt_keys_mirror_the_counters_outside_the_counter_scan() {
        assert_eq!(
            attempt_account_key("u", "1.2.3.4"),
            "cms:ranking:login-attempts:u|1.2.3.4"
        );
        assert_eq!(
            attempt_address_key("1.2.3.4"),
            "cms:ranking:login-attempts:ip#1.2.3.4"
        );
        assert_eq!(
            attempt_key_for(&account_key("u", "1.2.3.4")),
            attempt_account_key("u", "1.2.3.4")
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
