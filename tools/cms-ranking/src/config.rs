use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

pub const DEFAULT_BIND: &str = "0.0.0.0:8890";

/// Where the image keeps the vendored page. It is the directory the Python package
/// installs from, so the page and its assets keep one owner across the cutover.
pub const DEFAULT_STATIC_DIR: &str = "/home/cmsuser/src/src/cmsranking/static";

/// The Dockerfile pins CMS_CREDITS_FILE to this path; the licence offer must resolve
/// even when nothing is set in the environment.
pub const DEFAULT_CREDITS_FILE: &str = "/home/cmsuser/cms/credits.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingConfig {
    pub bind: SocketAddr,
    pub database_url: Option<String>,
    pub static_dir: Option<PathBuf>,
    pub credits_file: Option<PathBuf>,
    pub logo_path: Option<PathBuf>,
    /// Signs the console cookie. Absent means the console cannot log anyone in, which
    /// is a refusal rather than an open door.
    pub session_secret: Option<String>,
    pub captcha: CaptchaConfig,
    /// The Redis the failure counters live in. Absent means the console cannot track
    /// failures, which is a refusal at login rather than an unguarded door.
    pub redis_url: Option<String>,
}

/// Every CAPTCHA key stays in config.toml and is never edited from the panel, as you
/// decided. `enabled` is the single switch: off means the console accepts a login
/// without a challenge, which is what a development deployment wants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptchaConfig {
    pub enabled: bool,
    pub provider: CaptchaProvider,
    pub site_key: String,
    pub secret_key: String,
    pub threshold: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptchaProvider {
    Turnstile,
    HCaptcha,
}

impl CaptchaProvider {
    pub fn endpoint(self) -> &'static str {
        match self {
            Self::Turnstile => "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            Self::HCaptcha => "https://hcaptcha.com/siteverify",
        }
    }

    fn from_wire(raw: &str) -> Self {
        if raw.trim().eq_ignore_ascii_case("hcaptcha") {
            Self::HCaptcha
        } else {
            Self::Turnstile
        }
    }
}

impl Default for CaptchaConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: CaptchaProvider::Turnstile,
            site_key: String::new(),
            secret_key: String::new(),
            threshold: 3,
        }
    }
}

impl Default for RankingConfig {
    fn default() -> Self {
        Self {
            bind: DEFAULT_BIND.parse().expect("the default bind is a literal"),
            database_url: None,
            static_dir: None,
            credits_file: None,
            logo_path: None,
            session_secret: None,
            captcha: CaptchaConfig::default(),
            redis_url: None,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("RANKING_BIND_ADDRESS is not a socket address: {0}")]
    InvalidBind(String),
}

impl RankingConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_pairs(env::vars())
    }

    pub fn from_pairs<I, K, V>(pairs: I) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let vars: HashMap<String, String> = pairs
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect();
        Ok(Self {
            bind: read_bind(&vars)?,
            database_url: read_database_url(&vars),
            static_dir: read_path(&vars, "RANKING_STATIC_DIR", DEFAULT_STATIC_DIR),
            credits_file: read_path(&vars, "CMS_CREDITS_FILE", DEFAULT_CREDITS_FILE),
            logo_path: read_path(&vars, "RANKING_LOGO_PATH", ""),
            session_secret: read_secret(&vars),
            captcha: read_captcha(&vars),
            redis_url: read_trimmed_optional(&vars, "RANKING_REDIS_URL"),
        })
    }
}

fn read_bind(vars: &HashMap<String, String>) -> Result<SocketAddr, ConfigError> {
    let raw = vars
        .get("RANKING_BIND_ADDRESS")
        .map(String::as_str)
        .unwrap_or(DEFAULT_BIND);
    raw.parse::<SocketAddr>()
        .map_err(|_| ConfigError::InvalidBind(raw.to_string()))
}

fn read_database_url(vars: &HashMap<String, String>) -> Option<String> {
    vars.get("DATABASE_URL")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// An empty value means "not configured" rather than "the current directory", so a
/// blank variable disables the route it feeds instead of pointing it somewhere
/// unintended.
fn read_path(vars: &HashMap<String, String>, key: &str, fallback: &str) -> Option<PathBuf> {
    let raw = vars.get(key).map(String::as_str).unwrap_or(fallback).trim();
    if raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(raw))
    }
}

fn read_trimmed_optional(vars: &HashMap<String, String>, key: &str) -> Option<String> {
    let raw = read_trimmed(vars, key);
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn read_captcha(vars: &HashMap<String, String>) -> CaptchaConfig {
    CaptchaConfig {
        enabled: read_flag(vars, "CAPTCHA_ENABLED"),
        provider: CaptchaProvider::from_wire(
            vars.get("CAPTCHA_PROVIDER")
                .map(String::as_str)
                .unwrap_or("turnstile"),
        ),
        site_key: read_trimmed(vars, "CAPTCHA_SITE_KEY"),
        secret_key: read_trimmed(vars, "CAPTCHA_SECRET_KEY"),
        threshold: read_threshold(vars, "CAPTCHA_THRESHOLD", 3),
    }
}

/// Anything but 1/true is off: a half-written value must not enable a challenge the
/// deployment has no keys for.
fn read_flag(vars: &HashMap<String, String>, key: &str) -> bool {
    matches!(
        vars.get(key).map(|value| value.trim().to_ascii_lowercase()),
        Some(ref value) if value == "1" || value == "true"
    )
}

fn read_trimmed(vars: &HashMap<String, String>, key: &str) -> String {
    vars.get(key)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn read_threshold(vars: &HashMap<String, String>, key: &str, fallback: u32) -> u32 {
    vars.get(key)
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(fallback)
}

/// The console cannot issue or verify a cookie without this, so an unset value is a
/// refusal at the login route rather than a session nobody signed.
fn read_secret(vars: &HashMap<String, String>) -> Option<String> {
    vars.get("RANKING_SESSION_SECRET")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(values: &[(&str, &str)]) -> Vec<(String, String)> {
        values
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn defaults_to_the_ranking_port() {
        let config = RankingConfig::from_pairs(pairs(&[])).expect("defaults parse");
        assert_eq!(config.bind, "0.0.0.0:8890".parse().expect("a literal"));
        assert_eq!(config.database_url, None);
    }

    #[test]
    fn keeps_a_configured_database() {
        let config =
            RankingConfig::from_pairs(pairs(&[("DATABASE_URL", "postgres://cms@db/cmsdb")]))
                .expect("a valid url");
        assert_eq!(
            config.database_url.as_deref(),
            Some("postgres://cms@db/cmsdb")
        );
    }

    #[test]
    fn treats_a_blank_database_as_absent() {
        let config = RankingConfig::from_pairs(pairs(&[("DATABASE_URL", "  ")]))
            .expect("blank is tolerated");
        assert_eq!(config.database_url, None);
    }

    #[test]
    fn refuses_a_bind_that_is_not_an_address() {
        let error = RankingConfig::from_pairs(pairs(&[("RANKING_BIND_ADDRESS", "nowhere")]))
            .expect_err("an invalid address is rejected");
        assert_eq!(error, ConfigError::InvalidBind("nowhere".to_string()));
    }

    #[test]
    fn the_page_and_the_offer_have_image_defaults() {
        let config = RankingConfig::from_pairs(pairs(&[])).expect("defaults parse");
        assert_eq!(
            config.static_dir.as_deref(),
            Some(std::path::Path::new(DEFAULT_STATIC_DIR))
        );
        assert_eq!(
            config.credits_file.as_deref(),
            Some(std::path::Path::new(DEFAULT_CREDITS_FILE))
        );
        assert_eq!(config.logo_path, None);
    }

    #[test]
    fn a_blank_path_disables_the_route_it_feeds() {
        let config = RankingConfig::from_pairs(pairs(&[("RANKING_STATIC_DIR", "  ")]))
            .expect("blank is tolerated");
        assert_eq!(config.static_dir, None);
    }
}
