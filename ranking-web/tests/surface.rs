use std::path::PathBuf;

use cms_ranking::store::{Appearance, RankingContest, ShownSet};
use cms_ranking::surface::{credits_from_file, logo_path, render_page};

/// The shown set these tests render for: one contest, so the header has a contest to name. The
/// tests that are about the header build their own set.
fn shown() -> ShownSet {
    ShownSet::new(vec![9])
}

/// The page rendered for a board that shows contest 9.
fn page(
    appearance: Option<&Appearance>,
    contest: Option<&RankingContest>,
) -> Result<String, cms_ranking::surface::SurfaceError> {
    render_page(appearance, &shown(), contest)
}

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
        perspectives: None,
        wording_overrides: None,
        access_mode: "public".to_string(),
    }
}

/// The record the header reads its name and dates from.
fn contest(name: &str, begin: i32, end: i32) -> RankingContest {
    RankingContest {
        name: name.to_string(),
        begin,
        end,
    }
}

/// A settings row carrying the operator's words for the shown contest.
fn named(wording: Option<serde_json::Value>) -> Appearance {
    Appearance {
        wording_overrides: wording,
        ..appearance(None, None)
    }
}

/// 2026-10-16 00:00 UTC and the following midnight.
const DAY_ONE: i32 = 1_792_108_800;
const DAY_TWO: i32 = 1_792_195_200;

#[test]
fn the_board_header_names_the_contest_the_settings_name() {
    let row = named(None);
    let rendered = page(
        Some(&row),
        Some(&contest("POSN Oct 2026 Day 2", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(rendered.contains("<title>POSN Oct 2026 Day 2</title>"));
    assert!(!rendered.contains("<title>Ranking</title>"));
    assert!(rendered.contains("<h1 class=\"board-title\">POSN Oct 2026 Day 2</h1>"));
    assert!(rendered.contains("<p class=\"board-subtitle\">2026-10-16 – 2026-10-17</p>"));
}

#[test]
fn an_explicit_override_words_the_header_instead() {
    let wording = serde_json::json!({ "9": { "title": "Day Two", "subtitle": "Round two" } });
    let row = named(Some(wording));
    let rendered = page(
        Some(&row),
        Some(&contest("POSN Oct 2026 Day 2", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(rendered.contains("<title>Day Two</title>"));
    assert!(rendered.contains("<p class=\"board-subtitle\">Round two</p>"));
}

/// The regression the keying exists for: the words of a contest the board does not show
/// must not reach the header of the one it does.
#[test]
fn the_override_of_another_contest_does_not_word_this_header() {
    let wording = serde_json::json!({ "3": { "title": "ครั้งที่ 1", "subtitle": "วันที่ 1" } });
    let row = named(Some(wording));
    let rendered = page(
        Some(&row),
        Some(&contest("POSN Oct 2026 Day 2", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(!rendered.contains("ครั้งที่ 1"));
    assert!(rendered.contains("<title>POSN Oct 2026 Day 2</title>"));
}

/// A board the config shows no contest for is a real configuration, and it must not borrow
/// another contest's words: it falls back to the page's own title and no heading.
#[test]
fn a_board_showing_nothing_has_no_header() {
    let rendered = render_page(
        Some(&named(None)),
        &ShownSet::new(vec![]),
        Some(&contest("POSN Oct 2026 Day 2", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(rendered.contains("<title>Ranking</title>"));
    assert!(!rendered.contains("<h1 class=\"board-title\">POSN Oct 2026 Day 2</h1>"));
}

/// A board showing several contests names none of them rather than picking one, which is the
/// same silent choice the classic active-contest default made.
#[test]
fn a_board_showing_several_contests_names_none_of_them() {
    let rendered = render_page(
        Some(&named(None)),
        &ShownSet::new(vec![9, 3]),
        Some(&contest("POSN Oct 2026 Day 2", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(rendered.contains("<title>Ranking</title>"));
    assert!(!rendered.contains("POSN Oct 2026 Day 2"));
}

#[test]
fn the_default_title_is_kept_when_the_panel_names_none() {
    let rendered = page(None, None).expect("the page renders");
    assert!(rendered.contains("<title>Ranking</title>"));
}

/// The row's own free text is not the header any more: a deployment that has not named a
/// contest yet shows the default rather than copy that may describe another day.
#[test]
fn a_row_that_names_no_contest_words_nothing() {
    let rendered = page(Some(&appearance(Some("IOI 2026"), None)), None).expect("the page renders");
    assert!(rendered.contains("<title>Ranking</title>"));
    assert!(!rendered.contains("id=\"BoardHeading\""));
}

/// A named contest the projection has no record for yet leaves the default rather than a
/// heading invented from the id.
#[test]
fn a_contest_with_no_projected_record_leaves_the_default_title() {
    let rendered = page(Some(&named(None)), None).expect("the page renders");
    assert!(rendered.contains("<title>Ranking</title>"));
}

#[test]
fn a_title_is_escaped_rather_than_injected() {
    let rendered = page(
        Some(&named(None)),
        Some(&contest("<script>x</script>", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(!rendered.contains("<script>x"));
    // Askama's HTML escaper spells the brackets as numeric entities; what matters
    // is that the tag never reaches the document as markup.
    assert!(rendered.contains("&#60;script&#62;"));
}

#[test]
fn a_theme_becomes_custom_properties_before_the_head_closes() {
    let theme = serde_json::json!({ "accent": "#00A3DA", "background": "#101010" });
    let rendered = page(Some(&appearance(None, Some(theme))), None).expect("the page renders");
    assert!(rendered.contains("--ranking-accent: #00A3DA;"));
    assert!(rendered.contains("--ranking-background: #101010;"));
    assert!(rendered.contains("</style></head>"));
}

#[test]
fn a_theme_value_that_could_break_out_of_the_declaration_is_dropped() {
    let theme = serde_json::json!({ "accent": "#fff} body { display: none", "safe": "#123456" });
    let rendered = page(Some(&appearance(None, Some(theme))), None).expect("the page renders");
    assert!(!rendered.contains("display: none"));
    assert!(rendered.contains("--ranking-safe: #123456;"));
}

/// The template is compiled in, so unlike the vendored file it read before, the
/// answer is always a whole document rather than whatever was on disk.
#[test]
fn the_page_is_a_complete_document() {
    let rendered = page(None, None).expect("the page renders");
    assert!(rendered.starts_with("<!DOCTYPE html>"));
    assert!(rendered.trim_end().ends_with("</html>"));
}

fn notice(footer: Option<&str>, credits: Option<&str>) -> Appearance {
    Appearance {
        footer_text: footer.map(str::to_string),
        credits_text: credits.map(str::to_string),
        ..appearance(None, None)
    }
}

/// /config carries only two keys, so the panel's footer and credit line must reach
/// the page in the rendered HTML. They land inside the byline block it already has.
#[test]
fn the_panel_footer_lands_inside_the_license_notice() {
    let rendered = page(
        Some(&notice(Some("Hosted by ACME"), Some("Icons by Foo"))),
        None,
    )
    .expect("the page renders");
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
    let rendered =
        page(Some(&notice(Some("<script>x</script>"), None)), None).expect("the page renders");
    assert!(!rendered.contains("<script>x"));
    assert!(rendered.contains("&lt;script&gt;"));
}

#[test]
fn an_empty_footer_adds_no_block() {
    let rendered = page(Some(&notice(Some("  "), None)), None).expect("the page renders");
    assert!(!rendered.contains("id=\"ranking-footer\""));
    assert!(!rendered.contains("id=\"ranking-credits\""));
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

fn with_organisation(organisation: Option<&str>) -> Appearance {
    Appearance {
        organisation: organisation.map(str::to_string),
        ..named(None)
    }
}

/// /config carries only two keys, so the contest the settings name and the organisation reach
/// the reader through the rendered body, not through a wider object.
#[test]
fn the_named_contest_and_the_organisation_reach_the_body() {
    let rendered = page(
        Some(&with_organisation(Some("ACME"))),
        Some(&contest("IOI 2026", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(rendered.contains("<div id=\"BoardHeading\">"));
    assert!(rendered.contains("<h1 class=\"board-title\">IOI 2026</h1>"));
    assert!(rendered.contains("<div class=\"board-organisation\">ACME</div>"));
}

/// The heading block is opt-in: a row that names no contest renders no empty box.
#[test]
fn an_unset_heading_adds_no_block() {
    let rendered = page(Some(&appearance(None, None)), None).expect("the page renders");
    assert!(!rendered.contains("id=\"BoardHeading\""));
}

/// The scoreboard script reads the configured title off the body instead of hardcoding
/// "Ranking", so the served title has to be there for it to read.
#[test]
fn the_body_carries_the_configured_title() {
    let rendered = page(
        Some(&named(None)),
        Some(&contest("IOI 2026", DAY_ONE, DAY_TWO)),
    )
    .expect("the page renders");
    assert!(rendered.contains("data-board-title=\"IOI 2026\""));
}

/// The panel's anonymous flag reaches the body so the page can start with names hidden,
/// and an unset flag leaves them shown.
#[test]
fn the_body_carries_the_anonymous_flag() {
    let on = Appearance {
        columns: Some(serde_json::json!({ "anonymous": true })),
        ..appearance(None, None)
    };
    let rendered = page(Some(&on), None).expect("the page renders");
    assert!(rendered.contains("data-board-anonymous=\"true\""));
    let off = page(Some(&appearance(None, None)), None).expect("the page renders");
    assert!(off.contains("data-board-anonymous=\"false\""));
}

fn with_perspectives(value: serde_json::Value) -> Appearance {
    Appearance {
        perspectives: Some(value),
        ..appearance(None, None)
    }
}

/// With no panel config the page still gets a perspective list to read, so the tab
/// bar draws the built-in defaults rather than nothing.
#[test]
fn the_page_always_carries_a_perspective_config() {
    let rendered = page(None, None).expect("the page renders");
    assert!(rendered.contains("window.RankingPerspectives = {"));
    assert!(rendered.contains("\"default\":\"board\""));
    assert!(rendered.contains("\"overflow\":\"wrap\""));
}

/// A hand-edited row must not put a dead tab on the bar: the id is dropped before it
/// reaches the page.
#[test]
fn an_unknown_perspective_id_never_reaches_the_page() {
    let row = with_perspectives(serde_json::json!({
        "tabs": [ { "id": "board" }, { "id": "evil" } ]
    }));
    let rendered = page(Some(&row), None).expect("the page renders");
    assert!(rendered.contains("\"id\":\"board\""));
    assert!(!rendered.contains("evil"));
}

/// The injected literal is escaped, so a value in the row can never close the script
/// tag it sits inside.
#[test]
fn a_perspective_value_cannot_close_the_script_tag() {
    let row = with_perspectives(serde_json::json!({
        "tabs": [ { "id": "board", "options": { "x": "</script><img src=x>" } } ]
    }));
    let rendered = page(Some(&row), None).expect("the page renders");
    assert!(!rendered.contains("</script><img"), "{rendered}");
}
