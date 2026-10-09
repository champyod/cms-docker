use serde::Deserialize;

use crate::config::{CaptchaConfig, CaptchaProvider};

/// How many failures pass before a solved challenge is demanded. The panel uses three,
/// so the console does too; this is the CAPTCHA_THRESHOLD value.
pub fn challenge_required(failures: u32, threshold: u32) -> bool {
    threshold > 0 && failures >= threshold
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CaptchaError {
    #[error("the challenge was refused")]
    Refused,
    #[error("no captcha secret is configured")]
    Unconfigured,
    #[error("the provider could not be reached: {0}")]
    Unreachable(String),
}

#[derive(Deserialize)]
struct SiteVerify {
    success: bool,
}

/// Verifies one token against the provider. A disabled configuration accepts without
/// a challenge, because a deployment that set nothing must still be able to log in; an
/// enabled configuration with no secret refuses, because a check nobody can pass is
/// not a check. Neither branch is a network call, which is what makes this testable
/// without a provider key.
pub async fn verify(
    config: &CaptchaConfig,
    client: &reqwest::Client,
    token: &str,
    remote_ip: Option<&str>,
) -> Result<(), CaptchaError> {
    if !config.enabled {
        return Ok(());
    }
    if config.secret_key.is_empty() || config.site_key.is_empty() {
        return Err(CaptchaError::Unconfigured);
    }
    if token.trim().is_empty() {
        return Err(CaptchaError::Refused);
    }
    let mut form = vec![
        ("secret", config.secret_key.as_str()),
        ("response", token.trim()),
    ];
    if let Some(address) = remote_ip {
        form.push(("remoteip", address));
    }
    let response = client
        .post(config.provider.endpoint())
        .form(&form)
        .send()
        .await
        .map_err(|error| CaptchaError::Unreachable(error.to_string()))?;
    let verdict: SiteVerify = response
        .json()
        .await
        .map_err(|error| CaptchaError::Unreachable(error.to_string()))?;
    if verdict.success {
        Ok(())
    } else {
        Err(CaptchaError::Refused)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(enabled: bool, keys: bool) -> CaptchaConfig {
        CaptchaConfig {
            enabled,
            provider: CaptchaProvider::Turnstile,
            site_key: if keys {
                "site".to_string()
            } else {
                String::new()
            },
            secret_key: if keys {
                "secret".to_string()
            } else {
                String::new()
            },
            threshold: 3,
        }
    }

    fn client() -> reqwest::Client {
        reqwest::Client::new()
    }

    #[test]
    fn a_disabled_configuration_never_demands_a_challenge() {
        assert!(!challenge_required(0, 0));
        assert!(!challenge_required(99, 0));
    }

    #[test]
    fn the_threshold_is_where_the_challenge_starts() {
        assert!(!challenge_required(2, 3));
        assert!(challenge_required(3, 3));
        assert!(challenge_required(4, 3));
    }

    #[tokio::test]
    async fn a_disabled_provider_accepts_an_empty_token() {
        assert_eq!(
            verify(&config(false, false), &client(), "", None).await,
            Ok(())
        );
    }

    #[tokio::test]
    async fn an_enabled_provider_without_keys_fails_closed() {
        assert_eq!(
            verify(&config(true, false), &client(), "token", None).await,
            Err(CaptchaError::Unconfigured)
        );
    }

    #[tokio::test]
    async fn an_enabled_provider_refuses_an_empty_token_without_calling_out() {
        assert_eq!(
            verify(&config(true, true), &client(), "   ", None).await,
            Err(CaptchaError::Refused)
        );
    }
}
