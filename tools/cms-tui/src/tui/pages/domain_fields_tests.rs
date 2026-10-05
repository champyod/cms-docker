use super::{
    all_specs, is_truthy, seed_value, spec_for, FieldKind, FieldSpec, APPLY_FIELD, APPLY_LABEL,
    CERT_METHODS, FIELDS,
};
use crate::core::domain_setup::emitted_flag_names;

fn spec(label: &str) -> &'static FieldSpec {
    spec_for(label).expect("every row in the table resolves by label")
}

/// The form and the argv encoder must agree on the flag set. A row whose flag the encoder
/// dropped silently stops doing anything, which is the failure this catches.
#[test]
fn every_form_row_is_encodable() {
    let emitted = emitted_flag_names();
    for spec in all_specs() {
        assert!(
            emitted.contains(&spec.label),
            "{} has a form row but no argv encoder can send it",
            spec.label
        );
    }
}

/// Every flag the form does not offer is deliberately absent for a stated reason, so a new
/// omission has to be argued rather than slipping in:
///
/// - `--reason` and `--days` belong to the revoke and check-expiry verbs, reached as menu
///   rows rather than through this setup form.
/// - `--dry-run` is the script's own default and the form's state is the `--apply` row, so a
///   row for it would only offer a second, contradicting way to describe the same mode.
/// - `--yes` is always sent, because the form cannot answer the script's optional-feature
///   prompts and the script treats a non-interactive stdin the same way.
#[test]
fn the_flags_without_a_row_are_exactly_the_ones_deliberately_implied() {
    let rows: Vec<&str> = all_specs().map(|spec| spec.label).collect();
    let without_row: Vec<&str> = emitted_flag_names()
        .into_iter()
        .filter(|flag| !rows.contains(flag))
        .collect();
    assert_eq!(
        without_row,
        vec!["--reason", "--days", "--dry-run", "--yes"]
    );
}

/// `--apply` is the one row that must not start armed: a form that opened already live
/// would make "dry run by default" a property of the code rather than of the operator.
#[test]
fn every_boolean_row_starts_off_including_apply() {
    for spec in all_specs().filter(|spec| spec.kind == FieldKind::Toggle) {
        assert_eq!(seed_value(spec, ""), "off", "{} opened armed", spec.label);
    }
    assert_eq!(APPLY_FIELD.label, APPLY_LABEL);
    assert_eq!(APPLY_FIELD.kind, FieldKind::Toggle);
}

/// A blank counter row must not adopt the script's default: the encoder would then send a
/// flag the operator never typed, and keep sending it after the box raises its own default.
#[test]
fn a_blank_counter_row_stays_blank_and_only_shows_the_default_as_a_hint() {
    for label in ["--retry-attempts", "--retry-interval", "--wait-port80"] {
        assert_eq!(seed_value(spec(label), ""), "", "{label} adopted a default");
        assert!(
            !spec(label).script_default.is_empty(),
            "{label} lost the hint that tells the operator what blank does"
        );
    }
}

#[test]
fn a_configured_number_keeps_its_value_and_a_bad_one_is_not_forwarded() {
    assert_eq!(seed_value(spec("--retry-attempts"), "3"), "3");
    assert_eq!(
        seed_value(spec("--retry-attempts"), "0"),
        "0",
        "0 is a real cap"
    );
    // WHY blank rather than the script default: the encoder parses this row as a number,
    // so a non-numeric seed must never become argv.
    assert_eq!(seed_value(spec("--retry-attempts"), "many"), "");
    assert_eq!(seed_value(spec("--retry-attempts"), "3x"), "");
}

#[test]
fn every_config_truthy_spelling_opens_a_toggle_on() {
    for spelling in ["1", "on", "true", "yes", "ON"] {
        assert!(is_truthy(spelling), "{spelling} is how config spells set");
        assert_eq!(seed_value(spec("--staging"), spelling), "on");
    }
    for spelling in ["", "0", "off", "false", "no"] {
        assert!(
            !is_truthy(spelling),
            "{spelling} is how config spells unset"
        );
    }
}

/// A configured method the script would reject must not survive into the form, or the
/// page opens showing a plan that dies on the first certbot invocation.
#[test]
fn a_cert_method_the_script_would_reject_falls_back_to_the_default() {
    assert_eq!(seed_value(spec("--cert"), "provided"), "provided");
    for accepted in CERT_METHODS {
        assert_eq!(seed_value(spec("--cert"), accepted), accepted);
    }
    assert_eq!(seed_value(spec("--cert"), "wildcard"), "letsencrypt");
    assert_eq!(seed_value(spec("--cert"), ""), "letsencrypt");
}

#[test]
fn a_row_nothing_on_disk_backs_starts_blank() {
    for label in ["--cert-path", "--key-path"] {
        assert!(
            spec(label).key.is_none(),
            "{label} has no config key behind it"
        );
        assert_eq!(seed_value(spec(label), ""), "", "{label} opened prefilled");
    }
    assert!(
        spec(APPLY_LABEL).key.is_none(),
        "a run's mode is decided per run, not read from config"
    );
    assert_eq!(seed_value(spec(APPLY_LABEL), ""), "off");
}

#[test]
fn every_seeded_row_names_a_key_the_script_reads() {
    for spec in all_specs() {
        let Some(key) = spec.key else { continue };
        assert!(!key.trim().is_empty(), "{} has an empty key", spec.label);
    }
    assert!(FIELDS.len() > 15, "the form lost rows");
}
