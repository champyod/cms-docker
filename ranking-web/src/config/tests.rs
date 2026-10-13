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
fn a_configured_contest_scopes_the_board() {
    let config = RankingConfig::from_pairs(pairs(&[("RANKING_CONTEST_ID", "7")]))
        .expect("an integer contest is tolerated");
    assert_eq!(config.contest_id, Some(7));
}

#[test]
fn an_absent_contest_leaves_every_override_live() {
    let config = RankingConfig::from_pairs(pairs(&[])).expect("defaults parse");
    assert_eq!(config.contest_id, None);
}

/// Contest 0 is not a real contest, so a blank or unparsable value must read as "not
/// configured" rather than scope every override to it.
#[test]
fn an_unparsable_contest_is_absent_rather_than_zero() {
    for raw in ["", "  ", "seven"] {
        let config = RankingConfig::from_pairs(pairs(&[("RANKING_CONTEST_ID", raw)]))
            .expect("an unparsable contest is tolerated");
        assert_eq!(config.contest_id, None, "raw {raw:?}");
    }
}
