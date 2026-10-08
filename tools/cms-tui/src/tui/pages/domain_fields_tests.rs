//! Assertions on the domain field table: coverage, kinds, seeds, and the keys it reads.
//!
//! WHY these check the table against the encoder's flag list rather than against a
//! hand-written copy of it: a second copy of that list is a second thing to forget to
//! update, and the failure mode it would hide is a form that silently drops a flag.

use super::{
    all_specs, build_field, script_default, source_keys, spec_for, FieldSpec, CERT_METHODS,
};
use crate::tui::components::form_field::FieldKind;

/// Flags the encoder emits, excluding the ones that are always present.
const ENCODED_FLAGS: [&str; 23] = [
    "--domain",
    "--admin-domain",
    "--oj-domain",
    "--ranking-domain",
    "--cert-path",
    "--key-path",
    "--email",
    "--extra-domains",
    "--dns",
    "--dns-credentials",
    "--challenge",
    "--ca",
    "--acme-server",
    "--acme-client",
    "--tls-address",
    "--deploy-hook",
    "--retry-attempts",
    "--retry-interval",
    "--wait-port80",
    "--staging",
    "--force",
    "--backup-certs",
    "--lock",
];

#[test]
fn every_flag_the_encoder_can_emit_has_a_field() {
    for flag in ENCODED_FLAGS {
        assert!(spec_for(flag).is_some(), "no field for {flag}");
    }
}

#[test]
fn revoke_is_not_reachable_from_the_form() {
    for spec in all_specs() {
        assert!(
            !spec.label.contains("revoke"),
            "{} offers revocation",
            spec.label
        );
    }
}

#[test]
fn the_field_labels_are_unique() {
    let mut labels: Vec<&str> = all_specs().map(|spec| spec.label).collect();
    labels.sort_unstable();
    let before = labels.len();
    labels.dedup();
    assert_eq!(labels.len(), before, "duplicate field label");
}

#[test]
fn the_toggles_are_toggles_and_the_counters_are_integers() {
    for label in [
        "--staging",
        "--force",
        "--backup-certs",
        "--lock",
        "--auto-retry",
        "--retry-forever",
    ] {
        assert!(
            matches!(
                spec_for(label).expect("spec exists").kind,
                FieldKind::Toggle { .. }
            ),
            "{label} must be a checkbox"
        );
    }
    for label in ["--retry-attempts", "--retry-interval", "--wait-port80"] {
        assert!(
            matches!(
                spec_for(label).expect("spec exists").kind,
                FieldKind::Integer
            ),
            "{label} must be an integer field"
        );
    }
}

#[test]
fn the_text_rows_are_text() {
    for label in [
        "--cert",
        "--domain",
        "--email",
        "--extra-domains",
        "--dns",
        "--deploy-hook",
    ] {
        assert!(
            matches!(spec_for(label).expect("spec exists").kind, FieldKind::Text),
            "{label} must be a text field"
        );
    }
}

#[test]
fn apply_is_present_and_starts_switched_off() {
    let apply = spec_for("--apply").expect("apply is a row");
    assert!(!apply.is_on(), "a fresh form must be a dry run");
}

#[test]
fn an_unknown_label_resolves_to_nothing_rather_than_panicking() {
    assert!(spec_for("--nonexistent").is_none());
}

#[test]
fn every_seeded_row_names_a_key_and_the_typed_ones_name_none() {
    let typed: [&str; 3] = ["--apply", "--cert-path", "--key-path"];
    for spec in all_specs() {
        if typed.contains(&spec.label) {
            assert!(spec.key.is_none(), "{} has no key on disk", spec.label);
        } else {
            assert!(spec.key.is_some(), "{} needs a key", spec.label);
        }
    }
    assert_eq!(source_keys().len(), all_specs().count() - typed.len());
}

#[test]
fn the_retry_and_dns_rows_read_the_keys_the_script_sources() {
    for (label, key) in [
        ("--auto-retry", "AUTO_RETRY"),
        ("--retry-forever", "CERT_RETRY_FOREVER"),
        ("--retry-attempts", "CERT_RETRY_ATTEMPTS"),
        ("--retry-interval", "CERT_RETRY_INTERVAL"),
        ("--staging", "LE_STAGING"),
        ("--force", "FORCE_RENEWAL"),
        ("--backup-certs", "BACKUP_CERTS"),
        ("--lock", "USE_LOCK"),
        ("--wait-port80", "WAIT_PORT80_TIMEOUT"),
        ("--dns", "ACME_DNS_PROVIDER"),
        ("--dns-credentials", "ACME_DNS_CREDENTIALS_FILE"),
        ("--extra-domains", "EXTRA_DOMAINS"),
        ("--deploy-hook", "DEPLOY_HOOK"),
        ("--oj-domain", "CONTEST_DOMAIN"),
    ] {
        let spec: &FieldSpec = spec_for(label).expect("spec exists");
        assert_eq!(spec.key, Some(key), "{label} reads the wrong key");
    }
}

#[test]
fn the_counter_rows_leave_argv_to_the_script_and_record_their_defaults() {
    assert_eq!(spec_for("--retry-attempts").expect("spec").fallback, "");
    assert_eq!(spec_for("--retry-interval").expect("spec").fallback, "");
    assert_eq!(script_default("--retry-attempts"), Some("8"));
    assert_eq!(script_default("--retry-interval"), Some("15"));
    assert_eq!(script_default("--wait-port80"), Some("0"));
    assert_eq!(
        script_default("--domain"),
        None,
        "text rows have no default"
    );
}

#[test]
fn the_cert_row_starts_at_a_method_the_script_accepts() {
    let cert = spec_for("--cert").expect("spec exists");
    assert!(
        cert.key.is_some(),
        "the cert method is configured, not typed"
    );
    let seeded = build_field(cert, "");
    assert!(CERT_METHODS.contains(&seeded.value()));
    assert_eq!(seeded.value(), "letsencrypt");
}

#[test]
fn the_cert_row_opens_at_the_configured_method() {
    let cert = spec_for("--cert").expect("spec exists");
    assert_eq!(build_field(cert, "provided").value(), "provided");
}

#[test]
fn a_seeded_text_row_opens_showing_the_configured_value() {
    let spec = spec_for("--domain").expect("spec exists");
    assert_eq!(
        build_field(spec, "contest.example.org").value(),
        "contest.example.org"
    );
}

#[test]
fn an_unset_text_row_falls_back_to_its_declared_default() {
    let spec = spec_for("--cert").expect("spec exists");
    assert_eq!(build_field(spec, "").value(), "letsencrypt");
}

#[test]
fn a_seeded_switch_opens_checked_for_every_truthy_spelling() {
    let spec = spec_for("--staging").expect("spec exists");
    for seed in ["1", "on", "true", "yes"] {
        assert!(
            build_field(spec, seed).is_on(),
            "{seed} should check the box"
        );
    }
    for seed in ["0", "off", "", "no"] {
        assert!(
            !build_field(spec, seed).is_on(),
            "{seed} should leave it off"
        );
    }
}

#[test]
fn a_seeded_counter_opens_showing_the_configured_number() {
    let spec = spec_for("--retry-attempts").expect("spec exists");
    assert_eq!(build_field(spec, "3").value(), "3");
}

#[test]
fn a_non_numeric_seed_cannot_open_a_digits_only_row() {
    let spec = spec_for("--wait-port80").expect("spec exists");
    assert_eq!(
        build_field(spec, "not-a-number").value(),
        "",
        "a bad seed must not reach argv"
    );
}

#[test]
fn an_unknown_cert_method_is_not_seeded_into_the_form() {
    let spec = spec_for("--cert").expect("spec exists");
    assert_eq!(build_field(spec, "wildcard").value(), "letsencrypt");
}
