//! The domain form's row table: what every row is, and which `config.toml` key seeds it.
//!
//! WHY a table rather than a constructor call per row: the form has to show the operator
//! the effective value instead of a blank row, which means knowing the `config.toml` and
//! `.env` key behind every flag. That mapping is the part most likely to drift from
//! `__domain.sh`, so it is declared once and read by both the prefill and the renderer.

use crate::core::domain_setup::DEFAULT_CERT_METHOD;

/// `DOMAIN_CERT_METHOD` values the script's `--cert` parser accepts.
pub const CERT_METHODS: [&str; 3] = ["letsencrypt", "provided", "selfsigned"];

/// The `--cert` value a fresh form starts with.
pub const DEFAULT_CERT: &str = DEFAULT_CERT_METHOD;

/// What kind of edit a row accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    /// Free text.
    Text,
    /// Digits only, so a non-numeric seed cannot reach argv.
    Integer,
    /// A switch that is either on or off.
    Toggle,
}

/// One row of the domain form.
#[derive(Debug, Clone, Copy)]
pub struct FieldSpec {
    /// The `__domain.sh` flag this row edits, and the label the form is read back by.
    pub label: &'static str,
    pub kind: FieldKind,
    /// The config/env key this row is seeded from; `None` when nothing on disk backs it.
    ///
    /// WHY `None` is a real answer and not an oversight: `__domain.sh` resets `CERT_PATH`
    /// and `KEY_PATH` to empty before it parses anything, and a run's mode is decided per
    /// run. Both start blank and are typed per run, so inventing a config key for them
    /// would show a value the script ignores.
    pub key: Option<&'static str>,
    /// What the script does when this row is left blank, shown beside the row.
    ///
    /// WHY a number row starts blank rather than holding this value: the field seeds from
    /// it, and a seeded value is indistinguishable from one the operator typed, so it would
    /// be sent back in argv — freezing today's default into every run and keeping it after
    /// the box raises its own. The renderer shows this as a hint instead.
    pub script_default: &'static str,
}

/// A free-text row seeded from `key`.
const fn text(label: &'static str, key: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Text,
        key: Some(key),
        script_default: "",
    }
}

/// A free-text row nothing on disk backs, typed fresh per run.
const fn typed(label: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Text,
        key: None,
        script_default: "",
    }
}

/// A digits-only row seeded from `key`.
const fn number(label: &'static str, key: &'static str, script_default: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Integer,
        key: Some(key),
        script_default,
    }
}

/// A checkbox row seeded from `key`.
const fn switch(label: &'static str, key: &'static str) -> FieldSpec {
    FieldSpec {
        label,
        kind: FieldKind::Toggle,
        key: Some(key),
        script_default: "off",
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
    typed("--cert-path"),
    typed("--key-path"),
    // The retry group mirrors the script's own block. Keeping the toggles and their
    // counters adjacent is what makes "--retry-forever implies an unbounded run"
    // visible at the moment the operator is editing it.
    switch("--auto-retry", "AUTO_RETRY"),
    switch("--retry-forever", "CERT_RETRY_FOREVER"),
    number("--retry-attempts", "CERT_RETRY_ATTEMPTS", "8"),
    number("--retry-interval", "CERT_RETRY_INTERVAL", "15"),
    switch("--staging", "LE_STAGING"),
    switch("--force", "FORCE_RENEWAL"),
    number("--wait-port80", "WAIT_PORT80_TIMEOUT", "0"),
    switch("--backup-certs", "BACKUP_CERTS"),
    switch("--lock", "USE_LOCK"),
    text("--extra-domains", "EXTRA_DOMAINS"),
    text("--dns", "DNS_PROVIDER"),
    text("--dns-credentials", "DNS_CREDENTIALS_FILE"),
    text("--deploy-hook", "DEPLOY_HOOK"),
    switch("--json", "JSON_OUTPUT"),
    text("--config", "CONFIG_FILE"),
];

/// The row carrying `--apply`.
///
/// WHY the mode is a visible row and not a hidden confirm key: the operator has to be
/// able to see that a run will be live before starting it, and an invisible mode is how
/// a dry-run quietly becomes an apply.
pub const APPLY_FIELD: FieldSpec = FieldSpec {
    label: "--apply",
    kind: FieldKind::Toggle,
    key: None,
    script_default: "off",
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

/// The text a row should open with, given what the box currently has configured.
///
/// WHY the cert row is validated rather than copied: a `config.toml` naming a method the
/// script's parser rejects has to leave the row at an accepted value, otherwise the form
/// opens showing a plan that dies on the first certbot invocation.
#[must_use]
pub fn seed_value(spec: &FieldSpec, current: &str) -> String {
    // WHY a blank row stays blank for every kind: a seeded value is indistinguishable from
    // one the operator typed, so it would be sent back in argv. Only the renderer uses
    // `script_default`, and only to say what leaving the row blank will do.
    let value = current;
    match spec.kind {
        FieldKind::Toggle => on_off(is_truthy(value)),
        // WHY a rejected number row becomes blank rather than the script default: the
        // default belongs to the script, and a row that silently adopted it would send a
        // flag the operator never asked for.
        FieldKind::Integer => numeric_seed(value),
        FieldKind::Text if spec.label == "--cert" => cert_seed(value),
        FieldKind::Text => value.trim().to_string(),
    }
}

/// The spellings `config.toml` and the generated `.env` use for a set boolean.
#[must_use]
pub fn is_truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "on" | "true" | "yes"
    )
}

/// The same two words a toggle row reports, so a seed round-trips.
#[must_use]
pub fn on_off(is_on: bool) -> String {
    if is_on { "on" } else { "off" }.to_string()
}

/// Keeps a digits-only row digits-only; anything else reads as unset.
///
/// WHY blank rather than a fallback: the encoder parses this row as a number, so a
/// non-numeric value must never reach argv, and `0` is a real value — unbounded attempts —
/// so it must not stand in for "unset" either.
fn numeric_seed(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        String::new()
    } else {
        trimmed.to_string()
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
