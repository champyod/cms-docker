use std::path::Path;

use crate::store::Appearance;
use crate::surface::credits_from_file;

/// The offer a deployment with no readable credits file still has to make, because
/// section 13 of the licence binds the running service and not the file on disk.
pub const DEFAULT_SOURCE_URL: &str = "https://github.com/champyod/cms-docker";

/// The public configuration the vendored page reads before it draws anything.
///
/// WHY only these two fields: the captured /config body carries exactly
/// show_id_column and source_url, and access_mode in particular must not reach an
/// anonymous reader, because it names the protected-mode setting. The panel owns
/// more appearance than this, but it reaches the page through the rendered HTML
/// and the logo route, not through a wider config object.
#[derive(serde::Serialize)]
pub struct PublicConfig {
    pub show_id_column: bool,
    pub source_url: String,
}

/// The offer names the repository the credits file names, so a fork states its own
/// repository once: two spellings of it drift, and an offer naming another repository
/// than the credits page beside it contradicts itself.
///
/// WHY a fallback and never an error: a deployment with no readable credits file has
/// already lost the asset list, and losing the source offer with it would turn a
/// cosmetic fault into a licence breach.
pub fn source_url_from_credits(path: Option<&Path>) -> String {
    let named = path
        .and_then(|path| credits_from_file(path, None).ok())
        .and_then(|credits| {
            credits
                .project
                .get("url")
                .and_then(|url| url.as_str())
                .map(str::to_string)
        })
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    named.unwrap_or_else(|| DEFAULT_SOURCE_URL.to_string())
}

pub fn public_config(appearance: Option<Appearance>, source_url: &str) -> PublicConfig {
    PublicConfig {
        show_id_column: appearance.as_ref().is_some_and(Appearance::show_id_column),
        source_url: source_url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn appearance(columns: Option<serde_json::Value>) -> Appearance {
        Appearance {
            title: Some("IOI 2026".to_string()),
            subtitle: Some("Day 2".to_string()),
            organisation: None,
            logo_asset: None,
            favicon_asset: None,
            theme: Some(serde_json::json!({ "accent": "#00A3DA" })),
            columns,
            score_format: None,
            footer_text: Some("footer".to_string()),
            credits_text: Some("credits".to_string()),
            credits: None,
            perspectives: None,
            wording_overrides: None,
            access_mode: "protected".to_string(),
        }
    }

    /// A credits file of the test's own, named per case so parallel runs never share one.
    fn scratch_credits(name: &str, body: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "cms-ranking-credits-{name}-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("the clock is after the epoch")
                .as_nanos()
        ));
        std::fs::write(&path, body).expect("the fixture is written");
        path
    }

    /// The captured body is the contract: exactly two keys, and no more.
    #[test]
    fn the_body_is_the_two_captured_keys() {
        let body = crate::json::to_bytes(&public_config(
            Some(appearance(Some(
                serde_json::json!({ "show_id_column": true }),
            ))),
            DEFAULT_SOURCE_URL,
        ))
        .expect("the config serialises");
        assert_eq!(
            String::from_utf8(body).expect("utf-8"),
            format!(r#"{{"show_id_column": true, "source_url": "{DEFAULT_SOURCE_URL}"}}"#)
        );
    }

    /// A panel row must never widen the body back out, because access_mode leaking
    /// here would tell an anonymous reader the console is protected.
    #[test]
    fn the_protected_mode_setting_never_leaks() {
        let body =
            crate::json::to_bytes(&public_config(Some(appearance(None)), DEFAULT_SOURCE_URL))
                .expect("the config serialises");
        let text = String::from_utf8(body).expect("utf-8");
        assert!(!text.contains("access_mode"), "{text}");
        assert!(!text.contains("protected"), "{text}");
        assert!(!text.contains("title"), "{text}");
    }

    /// A row that does not exist yet publishes the vendored default rather than
    /// nothing: the page falls back to its own behaviour only if it can read them.
    #[test]
    fn a_missing_row_publishes_the_defaults() {
        let published = public_config(None, DEFAULT_SOURCE_URL);
        assert!(!published.show_id_column);
        assert_eq!(published.source_url, DEFAULT_SOURCE_URL);
    }

    /// The id column is a privacy switch, so only a real boolean turns it on: a string
    /// or a number from a hand-edited row must leave it off.
    #[test]
    fn the_id_column_needs_a_real_boolean() {
        for columns in [
            serde_json::json!({ "show_id_column": "true" }),
            serde_json::json!({ "show_id_column": 1 }),
            serde_json::json!({}),
        ] {
            let published = public_config(Some(appearance(Some(columns))), DEFAULT_SOURCE_URL);
            assert!(
                !published.show_id_column,
                "a mistyped value must not show ids"
            );
        }
    }

    /// The handler serves the URL it is given, so a fork's own repository can reach the
    /// page instead of the one compiled into this crate.
    #[test]
    fn a_configured_offer_is_served_verbatim() {
        let own = "https://git.example.invalid/own/cms";
        let body = crate::json::to_bytes(&public_config(None, own)).expect("the config serialises");
        assert_eq!(
            String::from_utf8(body).expect("utf-8"),
            format!(r#"{{"show_id_column": false, "source_url": "{own}"}}"#)
        );
    }

    /// The offer and the credits page are two renderings of one deployment's own
    /// repository, so /config takes its URL from the file /credits reads.
    #[test]
    fn the_offer_comes_from_the_credits_file() {
        let own = "https://git.example.invalid/own/cms";
        let path = scratch_credits(
            "own",
            &format!(
                r#"{{ "project": {{ "name": "Own", "url": "{own}" }}, "license": {{ "spdx_id": "AGPL-3.0" }}, "surfaces": {{ "ranking": {{ "title": "Ranking" }} }} }}"#
            ),
        );
        assert_eq!(source_url_from_credits(Some(&path)), own);
        std::fs::remove_file(&path).ok();
    }

    /// A file that cannot supply a URL must not blank the offer: the section 13 offer is
    /// the one thing that has to survive a broken deployment.
    #[test]
    fn an_unusable_credits_file_leaves_the_shipped_offer() {
        let nameless = scratch_credits(
            "nameless",
            r#"{ "project": { "name": "Own" }, "license": { "spdx_id": "AGPL-3.0" } }"#,
        );
        assert_eq!(source_url_from_credits(Some(&nameless)), DEFAULT_SOURCE_URL);
        std::fs::remove_file(&nameless).ok();
        let absent = std::env::temp_dir().join(format!(
            "cms-ranking-credits-absent-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("the clock is after the epoch")
                .as_nanos()
        ));
        assert_eq!(source_url_from_credits(Some(&absent)), DEFAULT_SOURCE_URL);
        assert_eq!(source_url_from_credits(None), DEFAULT_SOURCE_URL);
    }
}
