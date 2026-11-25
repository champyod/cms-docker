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
    let config = RankingConfig::from_pairs(pairs(&[("DATABASE_URL", "postgres://cms@db/cmsdb")]))
        .expect("a valid url");
    assert_eq!(
        config.database_url.as_deref(),
        Some("postgres://cms@db/cmsdb")
    );
}

#[test]
fn treats_a_blank_database_as_absent() {
    let config =
        RankingConfig::from_pairs(pairs(&[("DATABASE_URL", "  ")])).expect("blank is tolerated");
    assert_eq!(config.database_url, None);
}

#[test]
fn defaults_to_the_first_shard() {
    let config = RankingConfig::from_pairs(pairs(&[])).expect("defaults parse");
    assert_eq!(config.shard, DEFAULT_SHARD);
}

#[test]
fn session_cookies_are_secure_by_default() {
    let config = RankingConfig::from_pairs(pairs(&[])).expect("defaults parse");
    assert!(config.cookie_secure);
}

#[test]
fn local_http_can_explicitly_disable_secure_cookies() {
    let config = RankingConfig::from_pairs(pairs(&[("COOKIE_SECURE", "false")]))
        .expect("the local override parses");
    assert!(!config.cookie_secure);
}

#[test]
fn keeps_the_configured_shard() {
    let config =
        RankingConfig::from_pairs(pairs(&[("RANKING_SHARD", "3")])).expect("a valid shard");
    assert_eq!(config.shard, 3);
}

#[test]
fn an_unparsable_shard_falls_back_rather_than_refusing_to_start() {
    let config = RankingConfig::from_pairs(pairs(&[("RANKING_SHARD", "second")]))
        .expect("the service still starts");
    assert_eq!(config.shard, DEFAULT_SHARD);
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
    assert_eq!(
        config.avatar_dir.as_deref(),
        Some(std::path::Path::new(DEFAULT_AVATAR_DIR))
    );
}

#[test]
fn an_avatar_directory_turns_on_uploaded_faces() {
    let config = RankingConfig::from_pairs(pairs(&[("RANKING_AVATAR_DIR", "/data/faces")]))
        .expect("a directory is tolerated");
    assert_eq!(
        config.avatar_dir.as_deref(),
        Some(std::path::Path::new("/data/faces"))
    );
}

#[test]
fn a_blank_avatar_directory_falls_back_to_the_dummy_face() {
    let config = RankingConfig::from_pairs(pairs(&[("RANKING_AVATAR_DIR", "  ")]))
        .expect("blank is tolerated");
    assert_eq!(config.avatar_dir, None);
}

#[test]
fn a_blank_path_disables_the_route_it_feeds() {
    let config = RankingConfig::from_pairs(pairs(&[("RANKING_STATIC_DIR", "  ")]))
        .expect("blank is tolerated");
    assert_eq!(config.static_dir, None);
}

#[test]
fn trusted_proxies_default_to_none() {
    let config = RankingConfig::from_pairs(pairs(&[])).expect("defaults parse");
    assert!(config.trusted_proxies.is_empty());
}

#[test]
fn trusted_proxies_carry_networks_and_hosts() {
    let config = RankingConfig::from_pairs(pairs(&[(
        "RANKING_TRUSTED_PROXIES",
        "198.51.100.0/24, 2001:db8::1",
    )]))
    .expect("a valid list");
    assert_eq!(config.trusted_proxies.len(), 2);
}

#[test]
fn a_trust_all_proxy_is_refused() {
    let error = RankingConfig::from_pairs(pairs(&[("RANKING_TRUSTED_PROXIES", "0.0.0.0/0")]))
        .expect_err("a trust-all network is rejected");
    assert!(matches!(error, ConfigError::InvalidTrustedProxy(_)));
}
