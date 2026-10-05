//! The domain form's field table: what every row is, and which key seeds it.
//!
//! WHY a table rather than a constructor call per row: the form has to show the operator
//! the effective value instead of a blank row, which means knowing the `config.toml` and
//! `.env` key behind every flag. That mapping is the part most likely to drift from
//! `__domain.sh`, so it is declared once and read by both the prefill and the renderer.

use crate::core::domain_setup::DEFAULT_CERT_METHOD;
use crate::tui::components::form_field::{Field, FieldKind};

/// `DOMAIN_CERT_METHOD` values the script's `--cert` parser accepts.
pub const CERT_METHODS: [&str; 3] = ["letsencrypt", "provided", "selfsigned"];

/// The default `--cert` a fresh form starts with.
pub const DEFAULT_CERT: &str = DEFAULT_CERT_METHOD;

/// The script's defaults for the two retry counters, shown in otherwise-blank rows.
const DEFAULT_ATTEMPTS: &str = "8";
const DEFAULT_INTERVAL: &str = "15";

/// The script's own defaults for the counters, shown beside a row the operator left blank.
///
/// WHY these live here and not in the row table: the rows start blank on purpose (see
/// [`number`]), so this map is the only place the operator learns what an untouched row
/// will do.
const SCRIPT_DEFAULTS: [(&str, &str); 3] = [
    ("--retry-attempts", DEFAULT_ATTEMPTS),
    ("--retry-interval", DEFAULT_INTERVAL),
    ("--wait-port80", "0"),
];

/// What the script will do with `label` when the row is left as the form opens it.
#[must_use]
pub fn script_default(label: &str) -> Option<&'static str> {
    SCRIPT_DEFAULTS
        .iter()
        .find(|(row, _)| *row == label)
        .map(|(_, value)| *value)
}

/// One row of the domain form.
pub struct FieldSpec {
    /// The `__domain.sh` flag this row edits, and the label the form is read back by.
    pub label: &'static str,
    pub kind: FieldKind,
    /// The config/env key this row is seeded from; `None` when nothing on disk backs it.
    ///
    /// WHY `None` is a real answer and not an oversight: `__domain.sh` resets `CERT_PATH`
    /// and `KEY_PATH` to empty before it parses anything, and `--apply` is a per-run
    /// decision. Both start blank and are typed per run, so inventing a key for them
    /// would show a value the script ignores.
    pub key: Option<&'static str>,
    /// Text shown when the key has no value, and what the field starts as.
    pub fallback: &'static str,
}

impl FieldSpec {
    /// Whether this row starts checked.
    ///
    /// WHY every boolean row is declared off: a form that opened already armed at a live
    /// run would make "dry-run by default" a property of the code rather than of the UI.
    #[must_use]
    pub const fn is_on(&self) -> bool {
        matches!(self.kind, FieldKind::Toggle { is_on: true })
    }
}

/// A free-text row seeded from `key`.
const fn text(label: &'static str, key: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Text,
        key: Some(key),
        fallback: "",
    }
}

/// A digits-only row seeded from `key`, showing `default` when the key is unset.
///
/// WHY the number rows start blank rather than showing `default`: the form's job is to
/// show what the next run will do, and the script already applies `default` itself.
/// Sending it back would freeze today's default into argv, so a box that later raises
/// `CERT_RETRY_ATTEMPTS_DEFAULT` would keep the older number. The renderer shows the
/// script's default beside a blank row instead.
const fn number(label: &'static str, key: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Integer,
        key: Some(key),
        fallback: "",
    }
}

/// A checkbox row seeded from `key`.
const fn switch(label: &'static str, key: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Toggle { is_on: false },
        key: Some(key),
        fallback: "off",
    }
}

/// A row nothing on disk backs, typed fresh per run.
const fn typed(label: &'static str, kind: FieldKind) -> FieldSpec {
    FieldSpec {
        label,
        kind,
        key: None,
        fallback: "",
    }
}

/// Every value row, in the order the operator walks them.
///
/// WHY `--oj-domain` is seeded from `CONTEST_DOMAIN` and not a key of its own: the
/// script's `OJ_DOMAIN` is written into the generated `.env` from the contest section's
/// `CONTEST_DOMAIN`, so that is the name the operator actually configured.
pub const FIELDS: &[FieldSpec] = &[
    text("--cert", "DOMAIN_CERT_METHOD"),
    text("--domain", "DOMAIN_NAME"),
    text("--admin-domain", "ADMIN_DOMAIN"),
    text("--oj-domain", "CONTEST_DOMAIN"),
    text("--ranking-domain", "RANKING_DOMAIN"),
    text("--email", "CERT_EMAIL"),
    typed("--cert-path", FieldKind::Text),
    typed("--key-path", FieldKind::Text),
    // The retry group mirrors `__domain.sh`'s own block. Keeping the toggles and their
    // counters adjacent is what makes "--retry-forever implies an attempt cap of 0"
    // visible at the moment the operator is editing it.
    switch("--auto-retry", "AUTO_RETRY"),
    switch("--retry-forever", "CERT_RETRY_FOREVER"),
    number("--retry-attempts", "CERT_RETRY_ATTEMPTS"),
    number("--retry-interval", "CERT_RETRY_INTERVAL"),
    switch("--staging", "LE_STAGING"),
    switch("--force", "FORCE_RENEWAL"),
    switch("--backup-certs", "BACKUP_CERTS"),
    switch("--lock", "USE_LOCK"),
    switch("--auto-renew", "AUTO_RENEW"),
    number("--wait-port80", "WAIT_PORT80_TIMEOUT"),
    text("--extra-domains", "EXTRA_DOMAINS"),
    text("--dns", "DNS_PROVIDER"),
    text("--dns-credentials", "DNS_CREDENTIALS_FILE"),
    text("--deploy-hook", "DEPLOY_HOOK"),
];

/// The row carrying `--apply`.
///
/// WHY the mode is a visible row and not a hidden confirm key: the operator has to be
/// able to see that a run will be live before starting it, and an invisible mode is how
/// a dry-run quietly becomes an apply.
pub const APPLY_FIELD: FieldSpec = FieldSpec {
    label: "--apply",
    kind: FieldKind::Toggle { is_on: false },
    key: None,
    fallback: "off",
};

/// The label of the row whose arming requires a confirm step.
pub const APPLY_LABEL: &str = APPLY_FIELD.label;

/// Every spec, including the apply row.
pub fn all_specs() -> impl Iterator<Item = &'static FieldSpec> {
    FIELDS.iter().chain(std::iter::once(&APPLY_FIELD))
}

/// Looks a spec up by the label the form and the argv encoder both use.
#[must_use]
pub fn spec_for(label: &str) -> Option<&'static FieldSpec> {
    all_specs().find(|spec| spec.label == label)
}

/// The keys the form can be seeded from, for diagnostics and tests.
#[must_use]
pub fn source_keys() -> Vec<&'static str> {
    all_specs().filter_map(|spec| spec.key).collect()
}

/// Builds the editable field for `spec`, seeded with `current`.
///
/// WHY the seed is validated against the row's kind rather than copied blindly: a
/// `config.toml` that names a cert method the script would reject has to leave the row
/// at a value the script accepts, otherwise the form opens showing a plan that dies on
/// the first certbot invocation.
#[must_use]
pub fn build_field(spec: &FieldSpec, current: &str) -> Field {
    let value = seed_value(spec, current);
    let kind = match spec.kind {
        FieldKind::Toggle { .. } => FieldKind::Toggle {
            is_on: is_truthy(&value),
        },
        other => other,
    };
    Field::new(spec.label.to_string(), value, kind)
}

/// The text a row should open with, given what the box currently has.
fn seed_value(spec: &FieldSpec, current: &str) -> String {
    let value = if current.trim().is_empty() {
        spec.fallback
    } else {
        current
    };
    match spec.kind {
        FieldKind::Toggle { .. } => on_off(is_truthy(value)),
        FieldKind::Integer => numeric_seed(value, spec.fallback),
        FieldKind::Text if spec.label == "--cert" => cert_seed(value),
        FieldKind::Text => value.trim().to_string(),
    }
}

/// The spellings `config.toml` and the generated `.env` use for a set boolean.
fn is_truthy(value: &str) -> bool {
    matches!(value.trim(), "1" | "on" | "true" | "yes")
}

/// The same two words `Field::value` reports for a checkbox, so a seed round-trips.
fn on_off(is_on: bool) -> String {
    if is_on { "on" } else { "off" }.to_string()
}

/// Keeps a digits-only row digits-only, so a stray non-numeric seed cannot reach argv.
fn numeric_seed(value: &str, fallback: &'static str) -> String {
    let trimmed = value.trim();
    if !trimmed.is_empty() && trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

/// Falls back to the default method when the configured one is not in the script's list.
fn cert_seed(value: &str) -> String {
    if CERT_METHODS.contains(&value.trim()) {
        value.trim().to_string()
    } else {
        DEFAULT_CERT.to_string()
    }
}

#[cfg(test)]
#[path = "domain_fields_tests.rs"]
mod tests;
