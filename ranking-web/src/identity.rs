use std::sync::OnceLock;

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// A per-process salt keeps a username from being reversible by guessing it.
/// A stable identifier within one run is what lets the page join rows, history and
/// the submission list; a new run may pick new identifiers because no URL is durable.
fn salt() -> &'static [u8; 32] {
    static SALT: OnceLock<[u8; 32]> = OnceLock::new();
    SALT.get_or_init(|| {
        let mut bytes = [0_u8; 32];
        getrandom::getrandom(&mut bytes)
            .expect("the OS must provide entropy for anonymous identifiers");
        bytes
    })
}

/// What a public response may reveal about a person.
///
/// WHY it is a value rather than a boolean at each call site: every public surface
/// (board, users, scores, history, overrides, faces and the event stream) asks the
/// same question, and one answer is what keeps them from drifting apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    masked: bool,
}

impl Identity {
    pub fn new(masked: bool) -> Self {
        Self { masked }
    }

    pub fn masked(self) -> bool {
        self.masked
    }

    /// The identifier a public response may carry for a user key. Unmasked, it is
    /// the key the page has always used; masked, it is an opaque, stable surrogate.
    pub fn public_key(self, key: &str) -> String {
        if !self.masked {
            return key.to_string();
        }
        let mut mac =
            HmacSha256::new_from_slice(salt().as_slice()).expect("HMAC accepts a 32-byte key");
        mac.update(b"cms-ranking-public-key-v1\0");
        mac.update(key.as_bytes());
        let digest = mac.finalize().into_bytes();
        format!("p_{}", hex::encode(&digest[..8]))
    }

    /// The real key behind a public identifier, or None when it belongs to no
    /// candidate. The surrogate is one-way, so the only resolution is to derive
    /// every candidate's surrogate and compare.
    pub fn resolve<'a>(
        self,
        public: &str,
        candidates: impl Iterator<Item = &'a String>,
    ) -> Option<String> {
        candidates
            .into_iter()
            .find(|key| self.public_key(key) == public)
            .cloned()
    }

    /// The two name fields a public response may carry. The placeholder is the
    /// board's existing anonymous mark, not a blank that reads as a missing row.
    pub fn name(self, first: &str, last: &str) -> (String, String) {
        if self.masked {
            ("—".to_string(), String::new())
        } else {
            (first.to_string(), last.to_string())
        }
    }

    /// The event payload with any user key replaced by its public surrogate. The
    /// page uses these payloads to join rows, so an unmasked key here would undo the
    /// masking every other response applies.
    pub fn event_data(self, name: &str, data: &str) -> String {
        if !self.masked {
            return data.to_string();
        }
        match name {
            "user" => data.split_once(' ').map_or_else(
                || data.to_string(),
                |(operation, key)| format!("{operation} {}", self.public_key(key)),
            ),
            "score" => self.map_lines(data, 1),
            "board" => self.map_lines(data, 0),
            _ => data.to_string(),
        }
    }

    fn map_lines(self, data: &str, first_fields: usize) -> String {
        data.split('\n')
            .map(|line| {
                let fields: Vec<&str> = line.split(' ').collect();
                if fields.len() > first_fields {
                    let key = self.public_key(fields[0]);
                    let rest = fields[1..].join(" ");
                    if rest.is_empty() {
                        key
                    } else {
                        format!("{key} {rest}")
                    }
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unmasked_identity_passes_the_real_key_and_name() {
        let identity = Identity::new(false);
        assert_eq!(identity.public_key("alice"), "alice");
        assert_eq!(identity.name("Alice", "A."), ("Alice".into(), "A.".into()));
    }

    #[test]
    fn a_masked_identity_is_stable_and_hides_the_key() {
        let identity = Identity::new(true);
        let first = identity.public_key("alice");
        assert_eq!(first, identity.public_key("alice"));
        assert_ne!(first, "alice");
        assert!(first.starts_with("p_"));
        assert_ne!(first, identity.public_key("bob"));
    }

    #[test]
    fn a_masked_name_is_the_board_placeholder() {
        assert_eq!(
            Identity::new(true).name("Alice", "A."),
            ("—".into(), "".into())
        );
    }

    #[test]
    fn a_public_key_resolves_back_to_its_only_candidate() {
        let identity = Identity::new(true);
        let candidates = ["alice".to_string(), "bob".to_string()];
        let public = identity.public_key("bob");
        assert_eq!(
            identity.resolve(&public, candidates.iter()),
            Some("bob".to_string())
        );
        assert_eq!(identity.resolve("p_unknown", candidates.iter()), None);
    }

    #[test]
    fn a_masked_event_payload_names_the_surrogate_not_the_user() {
        let identity = Identity::new(true);
        let alice = identity.public_key("alice");
        assert_eq!(
            identity.event_data("user", "create alice"),
            format!("create {alice}")
        );
        assert_eq!(
            identity.event_data("score", "alice t0 30.0"),
            format!("{alice} t0 30.0")
        );
        assert_eq!(
            identity.event_data("board", "alice 30.0 1\nbob"),
            format!("{alice} 30.0 1\n{}", identity.public_key("bob"))
        );
    }

    #[test]
    fn an_unmasked_event_payload_is_unchanged() {
        let identity = Identity::new(false);
        assert_eq!(identity.event_data("user", "create alice"), "create alice");
        assert_eq!(identity.event_data("board", "alice 30.0 1"), "alice 30.0 1");
    }
}
