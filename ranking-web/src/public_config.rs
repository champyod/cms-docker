use crate::store::Appearance;

/// Used when no appearance row exists yet: the AGPL source offer must still name
/// a deployment someone can reach.
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

pub fn public_config(appearance: Option<Appearance>) -> PublicConfig {
    PublicConfig {
        show_id_column: appearance.as_ref().is_some_and(Appearance::show_id_column),
        source_url: DEFAULT_SOURCE_URL.to_string(),
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
            access_mode: "protected".to_string(),
        }
    }

    /// The captured body is the contract: exactly two keys, and no more.
    #[test]
    fn the_body_is_the_two_captured_keys() {
        let body = crate::json::to_bytes(&public_config(Some(appearance(Some(
            serde_json::json!({ "show_id_column": true }),
        )))))
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
        let body = crate::json::to_bytes(&public_config(Some(appearance(None))))
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
        let published = public_config(None);
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
            let published = public_config(Some(appearance(Some(columns))));
            assert!(
                !published.show_id_column,
                "a mistyped value must not show ids"
            );
        }
    }
}
