//! Projects the live domain form onto the shared [`DomainSetupRequest`].
//!
//! WHY this is a projection and not a second encoder: `cli::domain_args` builds the same
//! struct from clap's parsed flags and both then call
//! [`domain_setup_args`](crate::core::domain_setup::domain_setup_args). The TUI
//! contributing the other half of that pair is what makes "the form and the CLI cannot
//! disagree about what `--retry-forever` means" a structural fact rather than a review
//! promise.

use super::domain_fields::{is_truthy, on_off, APPLY_LABEL};
use crate::core::domain_setup::{DomainRetryPolicy, DomainSetupRequest, DomainSwitches};

/// The argv the form currently encodes for `verb`.
///
/// WHY `--apply` never appears by default: the form's apply row starts off and only the
/// confirm step turns it on, so a dry run is the normal case here.
#[must_use]
pub fn argv(form: &crate::tui::components::config_form::ConfigForm, verb: &str) -> Vec<String> {
    crate::core::domain_setup::domain_setup_args(verb, &request(form))
}

/// The [`DomainSetupRequest`] the form describes.
///
/// WHY a blank counter row means "unset" rather than 0: `0` is a real value the script
/// accepts — for attempts it means unbounded — so sending it for an untouched row would
/// turn an operator who only meant to change a domain into an unbounded retry loop.
///
/// WHY `is_yes` is always set: the form has no way to answer the script's optional-feature
/// prompts, and `__domain.sh` treats a non-interactive stdin the same as `--yes`, so
/// omitting it would only make that implicit.
#[must_use]
pub fn request(form: &crate::tui::components::config_form::ConfigForm) -> DomainSetupRequest {
    DomainSetupRequest {
        cert: cert_method(form),
        domain: text(form, "--domain"),
        admin_domain: text(form, "--admin-domain"),
        oj_domain: text(form, "--oj-domain"),
        ranking_domain: text(form, "--ranking-domain"),
        cert_path: text(form, "--cert-path"),
        key_path: text(form, "--key-path"),
        email: text(form, "--email"),
        extra_domains: text(form, "--extra-domains"),
        dns: text(form, "--dns"),
        dns_credentials: text(form, "--dns-credentials"),
        deploy_hook: text(form, "--deploy-hook"),
        config: text(form, "--config"),
        // WHY reason and days are read but never offered as rows: they belong to the
        // revoke and check-expiry verbs, and this form submits the setup-scope verbs.
        // The fields are set so the request is the same shape the CLI builds.
        reason: None,
        days: None,
        wait_port80: number(form, "--wait-port80"),
        retry: DomainRetryPolicy {
            is_auto_retry: is_on(form, "--auto-retry"),
            is_retry_forever: is_on(form, "--retry-forever"),
            attempts: number(form, "--retry-attempts"),
            interval: number(form, "--retry-interval"),
        },
        switches: DomainSwitches {
            is_staging: is_on(form, "--staging"),
            is_force: is_on(form, "--force"),
            is_backup_certs: is_on(form, "--backup-certs"),
            is_lock: is_on(form, "--lock"),
            is_json: is_on(form, "--json"),
        },
        mode: crate::core::domain_setup::DomainMode {
            // WHY the dry run is implied rather than sent: the script defaults to a plan
            // and only `--apply` changes the box, so an un-armed form is already a dry
            // run and sending `--dry-run` would only restate the default.
            is_dry_run: false,
            is_apply: is_on(form, APPLY_LABEL),
            is_yes: true,
        },
    }
}

/// The trimmed cert row, which stays a plain string because the encoder substitutes the
/// script's default method for a blank one rather than dropping the flag.
fn cert_method(form: &crate::tui::components::config_form::ConfigForm) -> String {
    form.value_of("--cert").trim().to_string()
}

/// Whether the form is asking for a live run rather than a plan.
#[must_use]
pub fn wants_apply(form: &crate::tui::components::config_form::ConfigForm) -> bool {
    is_on(form, APPLY_LABEL)
}

/// A trimmed text row; a blank row reads as unset so the script keeps its default.
fn text(form: &crate::tui::components::config_form::ConfigForm, label: &str) -> Option<String> {
    let value = form.value_of(label).trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// A digits-only row; a blank or non-numeric row reads as unset.
fn number(form: &crate::tui::components::config_form::ConfigForm, label: &str) -> Option<u32> {
    form.value_of(label).trim().parse().ok()
}

/// Whether a toggle row is on; an unknown label reads as off.
fn is_on(form: &crate::tui::components::config_form::ConfigForm, label: &str) -> bool {
    is_truthy(form.value_of(label))
}

/// The two words a toggle row reports, kept here so the form and the projection agree.
#[must_use]
pub fn toggle_word(is_on: bool) -> String {
    on_off(is_on)
}
