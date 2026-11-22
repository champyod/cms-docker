//! The AGPL offer the scoreboard serves: the JSON of /credits, the source URL /config
//! offers, and the library credits the page loads.
//!
//! These are the assertions of the retired Python suite
//! `src/cmstestsuite/unit_tests/ranking_credits_test.py`, re-expressed against the one
//! artefact both routes read: the checkout's own `credits.json`.

use std::path::PathBuf;

use cms_ranking::public_config::DEFAULT_SOURCE_URL;
use cms_ranking::surface::credits_from_file;

/// The checkout's own credits file, which the image copies to `CMS_CREDITS_FILE`
/// (`Dockerfile:210`), so it is the offer a deployment actually serves.
fn credits_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../credits.json")
}

fn credits_file() -> serde_json::Value {
    let path = credits_path();
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
    serde_json::from_str(&raw).expect("the credits file is JSON")
}

/// The route serves the ranking surface of the credits file, asset list included: a
/// partial offer would name libraries the licence page cannot account for.
#[test]
fn the_served_offer_is_the_credit_files_ranking_surface() {
    let served = credits_from_file(&credits_path(), None).expect("the offer reads");
    let file = credits_file();
    let expected = &file["surfaces"]["ranking"];
    assert_eq!(served.surface, *expected);
    let names: Vec<&str> = served.surface["assets"]
        .as_array()
        .expect("the offered surface carries an asset list")
        .iter()
        .filter_map(|asset| asset["name"].as_str())
        .collect();
    assert!(
        !names.is_empty(),
        "the scoreboard credits no third-party asset"
    );
    let filed: Vec<&str> = expected["assets"]
        .as_array()
        .expect("the credits file carries an asset list")
        .iter()
        .filter_map(|asset| asset["name"].as_str())
        .collect();
    assert_eq!(names, filed);
}

/// The project and the licence reach the page whole, and the body carries nothing else:
/// the scoreboard is unauthenticated, so it must not publish the asset lists of the
/// components a visitor never reaches here.
#[test]
fn the_offered_project_and_licence_are_the_credit_files() {
    let served = credits_from_file(&credits_path(), None).expect("the offer reads");
    let file = credits_file();
    assert_eq!(served.project, file["project"]);
    assert_eq!(served.license, file["license"]);
    assert_eq!(served.license["spdx_id"], "AGPL-3.0");
    let body = serde_json::to_value(&served).expect("the offer serialises");
    let mut keys: Vec<&str> = body
        .as_object()
        .expect("the offer is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, ["license", "project", "surface"]);
}

/// The constant is what a deployment with no readable credits file still serves, so it
/// has to name the repository the credits page names: two spellings would drift.
#[test]
fn the_shipped_offer_names_the_credit_files_repository() {
    assert_eq!(credits_file()["project"]["url"], DEFAULT_SOURCE_URL);
}

/// Four vendored libraries the page loads, each filed under its own name: a page that
/// stops loading one, or a credit that renames it, would ship it uncredited.
#[test]
fn every_library_the_page_loads_is_credited_by_name() {
    let page_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("static/Ranking.html");
    let page = std::fs::read_to_string(&page_path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", page_path.display()));
    let file = credits_file();
    let assets = file["surfaces"]["ranking"]["assets"]
        .as_array()
        .expect("the credits file carries an asset list");
    for (reference, name) in [
        ("lib/jquery.js", "jQuery 3.6.0"),
        ("lib/eventsource.js", "EventSource"),
        ("lib/raphael.js", "Raphael"),
        ("lib/explorercanvas.js", "explorerCanvas"),
    ] {
        assert!(
            page.contains(reference),
            "{} no longer loads {reference}",
            page_path.display()
        );
        let credited = assets.iter().any(|asset| {
            asset["name"] == name
                && asset["paths"].as_array().is_some_and(|paths| {
                    paths
                        .iter()
                        .any(|path| path.as_str().is_some_and(|path| path.ends_with(reference)))
                })
        });
        assert!(credited, "{reference} is not credited as {name}");
    }
}
