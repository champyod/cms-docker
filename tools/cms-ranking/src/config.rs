use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;

pub const DEFAULT_BIND: &str = "0.0.0.0:8890";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingConfig {
    pub bind: SocketAddr,
    pub database_url: Option<String>,
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
}
