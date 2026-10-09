use std::path::PathBuf;

use cms_ranking::store::Appearance;
use cms_ranking::surface::{credits_from_file, logo_path, render_page};

fn appearance(title: Option<&str>, theme: Option<serde_json::Value>) -> Appearance {
    Appearance {
        title: title.map(str::to_string),
        subtitle: None,
        organisation: None,
        logo_asset: None,
        favicon_asset: None,
        theme,
        columns: None,
        score_format: None,
        footer_text: None,
        credits_text: None,
        credits: None,
        access_mode: "public".to_string(),
    }
}

const PAGE: &str = "<html><head><title>Ranking</title></head><body>board</body></html>";

#[test]
fn the_panel_title_replaces_the_vendored_one() {
    let rendered = render_page(PAGE, Some(&appearance(Some("IOI 2026"), None)));
    assert!(rendered.contains("<title>IOI 2026</title>"));
    assert!(!rendered.contains("<title>Ranking</title>"));
}

#[test]
fn a_title_is_escaped_rather_than_injected() {
    let rendered = render_page(PAGE, Some(&appearance(Some("<script>x</script>"), None)));
    assert!(!rendered.contains("<script>x"));
    assert!(rendered.contains("&lt;script&gt;"));
}

#[test]
fn a_theme_becomes_custom_properties_before_the_head_closes() {
    let theme = serde_json::json!({ "accent": "#00A3DA", "background": "#101010" });
    let rendered = render_page(PAGE, Some(&appearance(None, Some(theme))));
    assert!(rendered.contains("--ranking-accent: #00A3DA;"));
    assert!(rendered.contains("--ranking-background: #101010;"));
    assert!(rendered.contains("</style></head>"));
}

#[test]
fn a_theme_value_that_could_break_out_of_the_declaration_is_dropped() {
    let theme = serde_json::json!({ "accent": "#fff} body { display: none", "safe": "#123456" });
    let rendered = render_page(PAGE, Some(&appearance(None, Some(theme))));
    assert!(!rendered.contains("display: none"));
    assert!(rendered.contains("--ranking-safe: #123456;"));
}

#[test]
fn a_page_without_a_head_is_returned_untouched() {
    let rendered = render_page("<html><body>bare</body></html>", None);
    assert_eq!(rendered, "<html><body>bare</body></html>");
}

fn notice(footer: Option<&str>, credits: Option<&str>) -> Appearance {
    Appearance {
        footer_text: footer.map(str::to_string),
        credits_text: credits.map(str::to_string),
        ..appearance(None, None)
    }
}

const PAGE_WITH_NOTICE: &str = "<html><body><div id=\"LicenseNotice\">Powered by CMS</div><div id=\"InnerFrame\"></div></body></html>";

/// /config carries only two keys, so the panel's footer and credit line must reach
/// the page in the rendered HTML. They land inside the byline block it already has.
#[test]
fn the_panel_footer_lands_inside_the_license_notice() {
    let rendered = render_page(
        PAGE_WITH_NOTICE,
        Some(&notice(Some("Hosted by ACME"), Some("Icons by Foo"))),
    );
    assert!(rendered.contains("<div id=\"ranking-footer\">Hosted by ACME</div>"));
    assert!(rendered.contains("<div id=\"ranking-credits\">Icons by Foo</div>"));
    let notice_at = rendered.find("LicenseNotice").expect("the notice is there");
    let footer_at = rendered
        .find("ranking-footer")
        .expect("the footer is there");
    let frame_at = rendered.find("InnerFrame").expect("the frame is there");
    assert!(footer_at > notice_at && footer_at < frame_at);
}

#[test]
fn a_footer_line_is_escaped_rather_than_injected() {
    let rendered = render_page(
        PAGE_WITH_NOTICE,
        Some(&notice(Some("<script>x</script>"), None)),
    );
    assert!(!rendered.contains("<script>x"));
    assert!(rendered.contains("&lt;script&gt;"));
}

#[test]
fn an_empty_footer_leaves_the_page_untouched() {
    let rendered = render_page(PAGE_WITH_NOTICE, Some(&notice(Some("  "), None)));
    assert_eq!(rendered, PAGE_WITH_NOTICE);
}

/// The vendored credits.html reads project["name"], license["name"], license["url"]
/// and license["spdx_id"], so the route must serve objects, not the flattened strings
/// the port used to emit.
#[test]
fn project_and_license_are_served_as_objects() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity/credits-sample.json");
    let credits = credits_from_file(&path, None).expect("the sample reads");
    assert_eq!(credits.project["name"], "CMS Docker");
    assert_eq!(credits.project["url"], "https://example.invalid/fork");
    assert_eq!(credits.license["id"], "AGPL-3.0");
    assert!(credits.project.is_object() && credits.license.is_object());
}

/// The Python route served the whole asset list for its surface, so the route has to
/// stay a complete offer and not just the licence line.
#[test]
fn the_full_ranking_credit_list_is_served() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity/credits-sample.json");
    let credits = credits_from_file(&path, None).expect("the sample reads");
    assert_eq!(credits.surface["title"], "Ranking");
}

/// A credits file written for another surface must serve nothing rather than the wrong
/// list: an offer that names somebody else's assets is worse than an empty one.
#[test]
fn a_credits_file_without_a_ranking_surface_serves_null() {
    let path = std::env::temp_dir().join(format!("credits-{}.json", std::process::id()));
    let body = r#"{ "project": { "name": "CMS Docker", "url": "https://example.invalid" }, "license": { "id": "AGPL-3.0" } }"#;
    std::fs::write(&path, body).expect("the fixture is written");
    let credits = credits_from_file(&path, None).expect("it reads");
    assert_eq!(credits.surface, serde_json::Value::Null);
    std::fs::remove_file(&path).ok();
}

#[test]
fn a_missing_credits_file_is_refused_rather_than_emptied() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity/absent.json");
    assert!(credits_from_file(&path, None).is_err());
}

/// A file whose project or license is a bare string is what the old port emitted and
/// what credits.html cannot read, so it is refused rather than half-served.
#[test]
fn a_flattened_credit_entry_is_refused() {
    let path = std::env::temp_dir().join(format!("credits-flat-{}.json", std::process::id()));
    let body = r#"{ "project": "CMS Docker", "license": "AGPL-3.0" }"#;
    std::fs::write(&path, body).expect("the fixture is written");
    assert!(credits_from_file(&path, None).is_err());
    std::fs::remove_file(&path).ok();
}

/// The panel stores one file per format and removes the others, so the configured path
/// is a stem and the format is whatever was last uploaded.
#[test]
fn a_logo_stem_resolves_to_the_format_on_disk() {
    let directory = std::env::temp_dir().join(format!("ranking-logo-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("a temporary directory");
    let stem = directory.join("logo");
    std::fs::write(directory.join("logo.jpg"), b"jpeg bytes").expect("the fixture is written");
    assert_eq!(
        logo_path(None, Some(&stem), &directory),
        directory.join("logo.jpg")
    );
    // png wins when both exist, matching the Python handler's preference order.
    std::fs::write(directory.join("logo.png"), b"png bytes").expect("the second fixture");
    assert_eq!(
        logo_path(None, Some(&stem), &directory),
        directory.join("logo.png")
    );
    std::fs::remove_dir_all(&directory).ok();
}

#[test]
fn a_logo_with_no_file_falls_back_to_the_vendored_asset() {
    let directory = std::env::temp_dir().join(format!("ranking-empty-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("a temporary directory");
    let fallback = logo_path(None, Some(&directory.join("absent")), &directory);
    assert_eq!(fallback, directory.join("img").join("logo.png"));
    std::fs::remove_dir_all(&directory).ok();
}

/// The panel's list wins over the vendored one, and a panel that has none leaves the file
/// in charge: the credit list is the one thing an operator may replace wholesale.
#[test]
fn the_panels_credit_list_wins_over_the_vendored_one() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity/credits-sample.json");
    let panel = serde_json::json!([{ "name": "Panel Asset" }]);
    let credits = credits_from_file(&path, Some(panel.clone())).expect("the sample reads");
    assert_eq!(credits.surface, panel);
    assert_eq!(
        credits.license["id"], "AGPL-3.0",
        "the licence is never taken from the panel"
    );
}
