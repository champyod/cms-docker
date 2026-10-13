use std::path::{Path, PathBuf};

use askama::Template;

use serde::Serialize;

use crate::store::Appearance;

/// The licence offer, in the shape the vendored credits.html reads: project and
/// license are objects (name, url, spdx_id), not strings, and surface is the asset
/// list for the ranking surface. Field order is sorted, matching json.dumps
/// sort_keys=True on the Python route.
#[derive(Debug, Serialize, PartialEq)]
pub struct Credits {
    pub license: serde_json::Value,
    pub project: serde_json::Value,
    pub surface: serde_json::Value,
}

#[derive(Debug, thiserror::Error)]
pub enum SurfaceError {
    #[error("the credits file could not be read: {0}")]
    Credits(String),
    #[error("the page could not be read: {0}")]
    Page(String),
}

/// Section 13 of the licence requires the running deployment to name its own
/// source, so a missing credits file is a compliance failure rather than a
/// cosmetic one: every caller refuses instead of serving an empty offer.
pub fn credits_from_file(
    path: &Path,
    panel_list: Option<serde_json::Value>,
) -> Result<Credits, SurfaceError> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| SurfaceError::Credits(format!("{}: {error}", path.display())))?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|error| SurfaceError::Credits(format!("{}: {error}", path.display())))?;
    // A named offer that flattens the licence to a string is what the page cannot
    // read, so a file that lacks either object is refused rather than half-served.
    let project = required_object(&parsed, "project", path)?;
    let license = required_object(&parsed, "license", path)?;
    // The panel's list wins when it has one; the vendored file is the fallback.
    let surface = panel_list.unwrap_or_else(|| {
        parsed
            .get("surfaces")
            .and_then(|surfaces| surfaces.get("ranking"))
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    });
    Ok(Credits {
        license,
        project,
        surface,
    })
}

fn required_object(
    parsed: &serde_json::Value,
    name: &str,
    path: &Path,
) -> Result<serde_json::Value, SurfaceError> {
    parsed
        .get(name)
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| {
            SurfaceError::Credits(format!(
                "{}: the {name} entry is not an object",
                path.display()
            ))
        })
}

/// The scoreboard page, owned by this crate rather than read from disk on every
/// request. The vendored copy stays only for the Python service this one replaces,
/// so the title, the theme and the byline are template values instead of splices
/// into a file whose markup the injection used to depend on.
#[derive(Debug, Template)]
#[template(path = "ranking.html")]
struct RankingPage<'a> {
    title: &'a str,
    heading: &'a str,
    subtitle: &'a str,
    organisation: &'a str,
    anonymous: bool,
    theme_block: &'a str,
    notice_extras: &'a str,
    perspectives_json: &'a str,
}

/// The title the page ships with, used when the panel names none.
const DEFAULT_TITLE: &str = "Ranking";

/// Applies what the panel owns: the title, the theme and the footer lines.
/// /config carries only the two keys the capture records, so the rest reaches the
/// reader through the rendered HTML rather than through a wider object.
pub fn render_page(appearance: Option<&Appearance>) -> Result<String, SurfaceError> {
    let panel_title = present(appearance.and_then(|row| row.title.as_deref()));
    let title = panel_title.unwrap_or(DEFAULT_TITLE);
    let heading = panel_title.unwrap_or("");
    let subtitle = present(appearance.and_then(|row| row.subtitle.as_deref())).unwrap_or("");
    let organisation =
        present(appearance.and_then(|row| row.organisation.as_deref())).unwrap_or("");
    let anonymous = appearance.is_some_and(Appearance::anonymous);
    let theme_block = theme_block(appearance.and_then(|row| row.theme.as_ref()));
    let notice_extras = notice_extras(appearance);
    let perspectives_json = crate::perspectives::script_json(&crate::perspectives::normalise(
        appearance.and_then(|row| row.perspectives.as_ref()),
    ));
    RankingPage {
        title,
        heading,
        subtitle,
        organisation,
        anonymous,
        theme_block: &theme_block,
        notice_extras: &notice_extras,
        perspectives_json: &perspectives_json,
    }
    .render()
    .map_err(|error| SurfaceError::Page(error.to_string()))
}

/// The panel's footer and compact credit line land inside the byline block the page
/// already reserves, so they are built as markup here and placed by the template.
/// Every line is escaped before it is wrapped, so a value can never become an element.
fn notice_extras(appearance: Option<&Appearance>) -> String {
    let Some(row) = appearance else {
        return String::new();
    };
    let footer = present(row.footer_text.as_deref());
    let credits = present(row.credits_text.as_deref());
    if footer.is_none() && credits.is_none() {
        return String::new();
    }
    let mut block = String::new();
    for (id, text) in [("ranking-footer", footer), ("ranking-credits", credits)] {
        if let Some(text) = text {
            block.push_str(&format!("<div id=\"{id}\">{}</div>", escape_html(text)));
        }
    }
    block
}

fn present(value: Option<&str>) -> Option<&str> {
    value.filter(|text| !text.trim().is_empty())
}

/// Theme values become CSS custom properties on the document. A value that could
/// close the declaration or open a new one is dropped, because this string lands
/// in a page that anyone can load. The caller marks the result safe only after
/// this has filtered it.
fn theme_block(theme: Option<&serde_json::Value>) -> String {
    let Some(theme) = theme.and_then(serde_json::Value::as_object) else {
        return String::new();
    };
    let declarations: Vec<String> = theme
        .iter()
        .filter_map(|(name, value)| {
            let value = value.as_str()?;
            if !is_safe_css_value(value) || !is_safe_css_name(name) {
                return None;
            }
            Some(format!("--ranking-{name}: {value};"))
        })
        .collect();
    if declarations.is_empty() {
        return String::new();
    }
    format!(
        "<style id=\"ranking-theme\">:root{{{}}}</style>",
        declarations.join("")
    )
}

fn is_safe_css_value(value: &str) -> bool {
    !value.is_empty()
        && !value
            .chars()
            .any(|character| matches!(character, ';' | '}' | '{' | '<' | '>' | '\n' | '\r'))
}

fn is_safe_css_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The logo the page shows: what the panel points at, then the configured host
/// file, then the asset the vendored page ships with.
pub fn logo_path(
    appearance: Option<&Appearance>,
    configured: Option<&Path>,
    static_dir: &Path,
) -> PathBuf {
    if let Some(asset) = appearance.and_then(|row| row.logo_asset.as_deref()) {
        let candidate = PathBuf::from(asset);
        if candidate.is_file() {
            return candidate;
        }
    }
    if let Some(path) = configured {
        if path.is_file() {
            return path.to_path_buf();
        }
        // A configured path with no extension is a stem, not a file: the operator names
        // where the logo lives and the upload decides whether it is a png or a jpg. The
        // Python handler negotiated this over Accept; probing in a fixed order keeps the
        // same outcome without a content-negotiation dance for one image.
        if path.extension().is_none() {
            if let Some(found) = probe_extensions(path) {
                return found;
            }
        }
    }
    static_dir.join("img").join("logo.png")
}

/// The image formats the Python handler accepted, in the order it preferred them.
const LOGO_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "bmp"];

fn probe_extensions(stem: &Path) -> Option<PathBuf> {
    LOGO_EXTENSIONS
        .iter()
        .map(|extension| stem.with_extension(extension))
        .find(|candidate| candidate.is_file())
}
