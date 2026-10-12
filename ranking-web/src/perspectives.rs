use serde_json::{json, Value};

/// The perspective ids the page registers; an unknown one is dropped, not rendered.
pub const PERSPECTIVE_IDS: [&str; 8] = [
    "board", "teams", "tasks", "scores", "progress", "time", "group", "metrics",
];

/// How the tab bar copes when the tabs do not fit one row.
pub const OVERFLOW_MODES: [&str; 3] = ["wrap", "scroll", "menu"];
pub const DEFAULT_OVERFLOW: &str = "wrap";
pub const DEFAULT_PERSPECTIVE: &str = "board";

/// The config the page falls back to when the panel has none, in registry order.
fn default_tabs() -> Vec<Value> {
    PERSPECTIVE_IDS
        .iter()
        .map(|id| json!({ "id": id, "enabled": true, "options": {} }))
        .collect()
}

/// Narrows the stored row to the shape the page reads, defaulting an empty row to all tabs.
pub fn normalise(raw: Option<&Value>) -> Value {
    let tabs = normalise_tabs(raw);
    json!({
        "version": 1,
        "default": normalise_default(raw, &tabs),
        "layout": { "overflow": normalise_overflow(raw) },
        "tabs": tabs,
    })
}

fn normalise_tabs(raw: Option<&Value>) -> Vec<Value> {
    let mut tabs: Vec<Value> = Vec::new();
    if let Some(list) = raw
        .and_then(|value| value.get("tabs"))
        .and_then(Value::as_array)
    {
        for entry in list {
            let Some(id) = entry.get("id").and_then(Value::as_str) else {
                continue;
            };
            if !PERSPECTIVE_IDS.contains(&id) || tabs.iter().any(|tab| tab["id"] == id) {
                continue;
            }
            let enabled = entry
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let options = entry
                .get("options")
                .filter(|value| value.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            tabs.push(json!({ "id": id, "enabled": enabled, "options": options }));
        }
    }
    if tabs.is_empty() {
        default_tabs()
    } else {
        tabs
    }
}

fn normalise_overflow(raw: Option<&Value>) -> String {
    let wanted = raw
        .and_then(|value| value.get("layout"))
        .and_then(|layout| layout.get("overflow"))
        .and_then(Value::as_str);
    match wanted {
        Some(mode) if OVERFLOW_MODES.contains(&mode) => mode.to_string(),
        _ => DEFAULT_OVERFLOW.to_string(),
    }
}

/// The default must name an enabled tab, else the first enabled one, else the board.
fn normalise_default(raw: Option<&Value>, tabs: &[Value]) -> String {
    let wanted = raw
        .and_then(|value| value.get("default"))
        .and_then(Value::as_str);
    if let Some(wanted) = wanted {
        if tabs
            .iter()
            .any(|tab| tab["id"] == wanted && tab["enabled"] == true)
        {
            return wanted.to_string();
        }
    }
    tabs.iter()
        .find(|tab| tab["enabled"] == true)
        .and_then(|tab| tab["id"].as_str())
        .unwrap_or(DEFAULT_PERSPECTIVE)
        .to_string()
}

/// The config as a JSON literal safe to place inside a `<script>` tag.
pub fn script_json(config: &Value) -> String {
    let text = match serde_json::to_string(config) {
        Ok(text) => text,
        Err(_) => "null".to_string(),
    };
    text.replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_row_is_every_perspective_enabled_and_wrapping() {
        let config = normalise(None);
        assert_eq!(config["default"], "board");
        assert_eq!(config["layout"]["overflow"], "wrap");
        let tabs = config["tabs"].as_array().expect("tabs is an array");
        assert_eq!(tabs.len(), PERSPECTIVE_IDS.len());
        assert!(tabs.iter().all(|tab| tab["enabled"] == true));
    }

    #[test]
    fn an_unknown_id_is_dropped_rather_than_rendered() {
        let raw = json!({ "tabs": [ { "id": "board" }, { "id": "nonsense" } ] });
        let tabs = normalise(Some(&raw))["tabs"].clone();
        let tabs = tabs.as_array().expect("an array");
        assert_eq!(tabs.len(), 1);
        assert_eq!(tabs[0]["id"], "board");
    }

    #[test]
    fn a_duplicate_id_is_kept_once() {
        let raw = json!({ "tabs": [ { "id": "board" }, { "id": "board" } ] });
        let tabs = normalise(Some(&raw))["tabs"].clone();
        assert_eq!(tabs.as_array().expect("an array").len(), 1);
    }

    #[test]
    fn a_mistyped_enabled_does_not_hide_a_tab() {
        let raw = json!({ "tabs": [ { "id": "board", "enabled": "no" } ] });
        assert_eq!(normalise(Some(&raw))["tabs"][0]["enabled"], true);
    }

    #[test]
    fn a_default_naming_a_disabled_tab_falls_through() {
        let raw = json!({
            "default": "teams",
            "tabs": [ { "id": "board", "enabled": true }, { "id": "teams", "enabled": false } ]
        });
        assert_eq!(normalise(Some(&raw))["default"], "board");
    }

    #[test]
    fn an_unknown_overflow_mode_becomes_wrap() {
        let raw = json!({ "layout": { "overflow": "explode" } });
        assert_eq!(normalise(Some(&raw))["layout"]["overflow"], "wrap");
    }

    #[test]
    fn a_known_overflow_mode_survives() {
        let raw = json!({ "layout": { "overflow": "menu" } });
        assert_eq!(normalise(Some(&raw))["layout"]["overflow"], "menu");
    }

    #[test]
    fn script_json_cannot_close_its_own_tag() {
        let config = json!({ "tabs": [ { "id": "board", "options": { "x": "</script><b>" } } ] });
        let text = script_json(&config);
        assert!(!text.contains("</script>"), "{text}");
        assert!(!text.contains('<'), "{text}");
    }
}
