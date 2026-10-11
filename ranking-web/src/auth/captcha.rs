use serde::Deserialize;

use crate::auth::counter::Counter;
use crate::config::{CaptchaConfig, CaptchaKeys, CaptchaProvider};

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

/// The first healthy provider with a complete key pair, else the first usable one.
///
/// WHY the first usable one when all are unhealthy: rendering nothing would leave
/// the challenge unanswerable.
pub async fn select_active<'a>(
    config: &'a CaptchaConfig,
    counter: Option<&Counter>,
) -> Option<(CaptchaProvider, &'a CaptchaKeys)> {
    let usable: Vec<(CaptchaProvider, &'a CaptchaKeys)> = config
        .providers
        .iter()
        .filter_map(|provider| {
            config
                .keys
                .get(provider)
                .filter(|keys| !keys.site_key.is_empty() && !keys.secret_key.is_empty())
                .map(|keys| (*provider, keys))
        })
        .collect();
    for (provider, keys) in &usable {
        if provider_healthy(counter, *provider).await {
            return Some((*provider, keys));
        }
    }
    usable.into_iter().next()
}

async fn provider_healthy(counter: Option<&Counter>, provider: CaptchaProvider) -> bool {
    match counter {
        Some(counter) => counter.provider_healthy(provider).await,
        None => true,
    }
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
    requested: Option<CaptchaProvider>,
    counter: Option<&Counter>,
) -> Result<(), CaptchaError> {
    if !config.enabled {
        return Ok(());
    }
    let active = config.active().ok_or(CaptchaError::Unconfigured)?;
    // WHY the posted provider wins: a token is only meaningful to the provider
    // that issued it, and the chain may have shifted between render and submit.
    let (provider, keys) = requested
        .and_then(|name| config.keys.get(&name).map(|keys| (name, keys)))
        .filter(|(_, keys)| !keys.secret_key.is_empty())
        .unwrap_or(active);
    if token.trim().is_empty() {
        return Err(CaptchaError::Refused);
    }
    let mut form = vec![
        ("secret", keys.secret_key.as_str()),
        ("response", token.trim()),
    ];
    if let Some(address) = remote_ip {
        form.push(("remoteip", address));
    }
    let response = match client.post(provider.endpoint()).form(&form).send().await {
        Ok(response) => response,
        Err(error) => {
            if let Some(counter) = counter {
                counter.record_provider_failure(provider).await;
            }
            return Err(CaptchaError::Unreachable(error.to_string()));
        }
    };
    let verdict: SiteVerify = match response.json().await {
        Ok(verdict) => verdict,
        Err(error) => {
            if let Some(counter) = counter {
                counter.record_provider_failure(provider).await;
            }
            return Err(CaptchaError::Unreachable(error.to_string()));
        }
    };
    if let Some(counter) = counter {
        counter.record_provider_success(provider).await;
    }
    if verdict.success {
        Ok(())
    } else {
        Err(CaptchaError::Refused)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CaptchaKeys, CaptchaProvider};
    use std::collections::HashMap;

    fn config(enabled: bool, keys: bool) -> CaptchaConfig {
        let mut captcha = CaptchaConfig {
            enabled,
            threshold: 3,
            providers: vec![CaptchaProvider::Turnstile],
            keys: HashMap::new(),
        };
        captcha.keys.insert(
            CaptchaProvider::Turnstile,
            CaptchaKeys {
                site_key: if keys { "site".to_string() } else { String::new() },
                secret_key: if keys {
                    "secret".to_string()
                } else {
                    String::new()
                },
            },
        );
        captcha
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
            verify(&config(false, false), &client(), "", None, None, None).await,
            Ok(())
        );
    }

    #[tokio::test]
    async fn an_enabled_provider_without_keys_fails_closed() {
        assert_eq!(
            verify(&config(true, false), &client(), "token", None, None, None).await,
            Err(CaptchaError::Unconfigured)
        );
    }

    #[tokio::test]
    async fn an_enabled_provider_refuses_an_empty_token_without_calling_out() {
        assert_eq!(
            verify(&config(true, true), &client(), "   ", None, None, None).await,
            Err(CaptchaError::Refused)
        );
    }
}
