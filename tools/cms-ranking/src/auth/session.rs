use hmac::{Hmac, Mac};
use sha2::Sha256;

/// The console issues its own cookie, as you decided: the ranking surface has its own
/// accounts, so it should not depend on the panel reaching it or on sharing a secret
/// with it.
pub const COOKIE_NAME: &str = "ranking_session";
pub const TTL_SECONDS: i64 = 8 * 60 * 60;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub username: String,
    pub expires_at: i64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SessionError {
    #[error("no session secret is configured")]
    NoSecret,
    #[error("the session token is malformed")]
    Malformed,
    #[error("the session has expired")]
    Expired,
    #[error("the session signature does not match")]
    BadSignature,
}

/// Payload, expiry and signature. The signature covers the first two, so an expiry
/// cannot be extended without the secret even though it is readable.
pub fn issue(secret: &str, username: &str, now: i64) -> Result<String, SessionError> {
    if secret.is_empty() {
        return Err(SessionError::NoSecret);
    }
    if username.is_empty() || username.contains('.') {
        return Err(SessionError::Malformed);
    }
    let expires_at = now + TTL_SECONDS;
    let payload = format!("{username}.{expires_at}");
    let signature = sign(secret, payload.as_bytes())?;
    Ok(format!("{payload}.{signature}"))
}

pub fn verify(secret: &str, token: &str, now: i64) -> Result<Session, SessionError> {
    if secret.is_empty() {
        return Err(SessionError::NoSecret);
    }
    let mut parts = token.rsplitn(3, '.');
    let signature = parts.next().ok_or(SessionError::Malformed)?;
    let expires_at = parts.next().ok_or(SessionError::Malformed)?;
    let username = parts.next().ok_or(SessionError::Malformed)?;
    let expires_at: i64 = expires_at.parse().map_err(|_| SessionError::Malformed)?;
    if username.is_empty() {
        return Err(SessionError::Malformed);
    }
    let payload = format!("{username}.{expires_at}");
    let expected = decode(signature).ok_or(SessionError::Malformed)?;
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| SessionError::NoSecret)?;
    mac.update(payload.as_bytes());
    // verify_slice is the constant-time comparison; a hand-written equality would
    // leak how much of a forged signature was right.
    mac.verify_slice(&expected)
        .map_err(|_| SessionError::BadSignature)?;
    if now >= expires_at {
        return Err(SessionError::Expired);
    }
    Ok(Session {
        username: username.to_string(),
        expires_at,
    })
}

fn sign(secret: &str, payload: &[u8]) -> Result<String, SessionError> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| SessionError::NoSecret)?;
    mac.update(payload);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn decode(signature: &str) -> Option<Vec<u8>> {
    hex::decode(signature).ok()
}

/// The cookie value from a Cookie header, without pulling in a cookie crate for one
/// name: the only thing here is a split on ';' and a prefix match.
pub fn cookie_value(header: &str, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    header.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix(&prefix).map(str::to_string)
    })
}

pub fn set_cookie(token: &str, secure: bool) -> String {
    let secure_flag = if secure { "; Secure" } else { "" };
    format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={TTL_SECONDS}{secure_flag}"
    )
}

pub fn clear_cookie() -> String {
    format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_round_trips_and_carries_the_username() {
        let token = issue("secret", "operator", 1_000).expect("a token is issued");
        let session = verify("secret", &token, 1_100).expect("the token verifies");
        assert_eq!(session.username, "operator");
        assert_eq!(session.expires_at, 1_000 + TTL_SECONDS);
    }

    #[test]
    fn another_secret_cannot_forge_a_session() {
        let token = issue("secret", "operator", 1_000).expect("a token is issued");
        assert_eq!(
            verify("other", &token, 1_100),
            Err(SessionError::BadSignature)
        );
    }

    #[test]
    fn a_tampered_signature_is_refused() {
        let token = issue("secret", "operator", 1_000).expect("a token is issued");
        let mut tampered = token.clone();
        tampered.pop();
        tampered.push(if token.ends_with('a') { 'b' } else { 'a' });
        assert_eq!(
            verify("secret", &tampered, 1_100),
            Err(SessionError::BadSignature)
        );
    }

    #[test]
    fn a_longer_expiry_cannot_be_claimed_without_the_secret() {
        let token = issue("secret", "operator", 1_000).expect("a token is issued");
        let forged = token.replace(&format!(".{}", 1_000 + TTL_SECONDS), ".9999999999");
        assert!(verify("secret", &forged, 1_100).is_err());
    }

    #[test]
    fn an_expired_session_is_refused() {
        let token = issue("secret", "operator", 1_000).expect("a token is issued");
        assert_eq!(
            verify("secret", &token, 1_000 + TTL_SECONDS),
            Err(SessionError::Expired)
        );
    }

    #[test]
    fn a_malformed_token_is_refused() {
        assert_eq!(
            verify("secret", "nonsense", 1),
            Err(SessionError::Malformed)
        );
        assert_eq!(verify("secret", "a.b.c", 1), Err(SessionError::Malformed));
    }

    #[test]
    fn an_unconfigured_secret_fails_closed() {
        assert_eq!(issue("", "operator", 1), Err(SessionError::NoSecret));
        assert_eq!(verify("", "a.1.ff", 1), Err(SessionError::NoSecret));
    }

    #[test]
    fn the_cookie_reader_finds_the_named_value_only() {
        let header = "other=1; ranking_session=abc.def; trailing=2";
        assert_eq!(
            cookie_value(header, COOKIE_NAME).as_deref(),
            Some("abc.def")
        );
        assert_eq!(cookie_value(header, "absent"), None);
    }

    #[test]
    fn the_cookie_is_http_only_and_lax() {
        let cookie = set_cookie("token", true);
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains("Secure"));
        assert!(clear_cookie().contains("Max-Age=0"));
    }
}
