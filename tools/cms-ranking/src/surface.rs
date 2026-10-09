use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::store::Appearance;

/// The licence offer plus the panel-editable text. project and license keep the
/// names the Python /credits route used so an existing consumer still reads them.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Credits {
    pub project: String,
    pub license: String,
    pub source_url: String,
    pub text: Option<String>,
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
pub fn credits_from_file(path: &Path, text: Option<String>) -> Result<Credits, SurfaceError> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| SurfaceError::Credits(format!("{}: {error}", path.display())))?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|error| SurfaceError::Credits(format!("{}: {error}", path.display())))?;
    let project = parsed
        .get("project")
        .and_then(|value| value.get("name"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("CMS")
        .to_string();
    let license = parsed
        .get("license")
        .and_then(|value| value.get("id"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("AGPL-3.0")
        .to_string();
    let source_url = parsed
        .get("project")
        .and_then(|value| value.get("url"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("https://github.com/champyod/cms-docker")
        .to_string();
    Ok(Credits {
        project,
        license,
        source_url,
        text,
    })
}

pub fn read_page(path: &Path) -> Result<String, SurfaceError> {
    std::fs::read_to_string(path)
        .map_err(|error| SurfaceError::Page(format!("{}: {error}", path.display())))
}

/// Applies what the panel owns to the vendored page: the title and the theme.
/// Everything else reaches the page through /config, which Config.js already
/// fetches synchronously before the scoreboard renders.
pub fn render_page(html: &str, appearance: Option<&Appearance>) -> String {
    let titled = apply_title(html, appearance.and_then(|row| row.title.as_deref()));
    apply_theme(&titled, appearance.and_then(|row| row.theme.as_ref()))
}

fn apply_title(html: &str, title: Option<&str>) -> String {
    let Some(title) = title.filter(|value| !value.trim().is_empty()) else {
        return html.to_string();
    };
    let start = html.find("<title>");
    let end = html.find("</title>");
    match (start, end) {
        (Some(start), Some(end)) if start < end => {
            let mut rendered = String::with_capacity(html.len());
            rendered.push_str(&html[..start + "<title>".len()]);
            rendered.push_str(&escape_html(title));
            rendered.push_str(&html[end..]);
            rendered
        }
        _ => html.to_string(),
    }
}

/// Theme values become CSS custom properties on the document. A value that could
/// close the declaration or open a new one is refused, because this string lands
/// in a page that anyone can load.
fn apply_theme(html: &str, theme: Option<&serde_json::Value>) -> String {
    let Some(theme) = theme.and_then(serde_json::Value::as_object) else {
        return html.to_string();
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
        return html.to_string();
    }
    let block = format!(
        "<style id=\"ranking-theme\">:root{{{}}}</style>",
        declarations.join("")
    );
    match html.find("</head>") {
        Some(position) => {
            let mut rendered = String::with_capacity(html.len() + block.len());
            rendered.push_str(&html[..position]);
            rendered.push_str(&block);
            rendered.push_str(&html[position..]);
            rendered
        }
        None => html.to_string(),
    }
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
    }
    static_dir.join("img").join("logo.png")
}
