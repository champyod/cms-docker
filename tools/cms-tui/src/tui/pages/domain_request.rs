//! Projects the live domain form onto the shared [`DomainSetupRequest`] struct.
//!
//! WHY this is a projection and not a second encoder: `cli::resolve` builds the same
//! struct from clap's parsed flags and hands both to `core::domain_setup::domain_setup_args`.
//! The TUI contributing the other half of that pair is what makes "the form and the CLI
//! cannot disagree about what --retry-forever means" a structural fact rather than a
//! review promise.

use super::domain_fields::APPLY_LABEL;
use crate::core::domain_setup::{
    domain_setup_args, DomainRetryPolicy, DomainScope, DomainSetupRequest, DomainStorePolicy,
    DomainSwitches,
};
use crate::tui::components::config_form::ConfigForm;

/// The argv the form currently encodes.
///
/// WHY `--apply` never appears by default: the form's apply row starts off and only the
/// confirm step turns it on, so this function returning a dry run is the normal case.
#[must_use]
pub fn argv(form: &ConfigForm) -> Vec<String> {
    domain_setup_args("setup", &request(form))
}

/// The [`DomainSetupRequest`] the form describes.
///
/// WHY a blank counter row means "unset" rather than 0: `0` is a real value the script
/// accepts — for attempts it means unlimited — so sending it for an untouched row would
/// turn an operator who only meant to change a domain into an unbounded retry loop.
///
/// WHY `is_yes` is always set: the form has no way to answer the script's optional-feature
/// prompts, and `__domain.sh` treats a non-interactive stdin the same as `--yes`, so
/// omitting it would only make that implicit.
#[must_use]
pub fn request(form: &ConfigForm) -> DomainSetupRequest {
    DomainSetupRequest {
        cert: text(form, "--cert"),
        domain: text(form, "--domain"),
        admin_domain: text(form, "--admin-domain"),
        oj_domain: text(form, "--oj-domain"),
        ranking_domain: text(form, "--ranking-domain"),
        email: text(form, "--email"),
        cert_path: text(form, "--cert-path"),
        key_path: text(form, "--key-path"),
        extra_domains: text(form, "--extra-domains"),
        dns: text(form, "--dns"),
        dns_credentials: text(form, "--dns-credentials"),
        deploy_hook: text(form, "--deploy-hook"),
        // WHY the whole scope: the form has no row for narrowing, and a setup form that
        // rendered nginx would quietly stop issuing the certificate it is named for.
        scope: DomainScope::Both,
        retry: DomainRetryPolicy {
            attempts: form.number_of("--retry-attempts"),
            interval: form.number_of("--retry-interval"),
            is_auto_retry: form.is_on("--auto-retry"),
            is_retry_forever: form.is_on("--retry-forever"),
        },
        wait_port80: form.number_of("--wait-port80"),
        switches: DomainSwitches {
            is_staging: form.is_on("--staging"),
            is_force: form.is_on("--force"),
            is_lock: form.is_on("--lock"),
        },
        store: DomainStorePolicy {
            is_backup_certs: form.is_on("--backup-certs"),
            is_auto_renew: form.is_on("--auto-renew"),
        },
        is_apply: wants_apply(form),
        is_yes: true,
    }
}

/// Whether the form is asking for a live run rather than a dry run.
#[must_use]
pub fn wants_apply(form: &ConfigForm) -> bool {
    form.is_on(APPLY_LABEL)
}

/// A trimmed text row; a missing row reads as blank so the script keeps its default.
fn text(form: &ConfigForm, label: &str) -> String {
    form.value_of(label).trim().to_string()
}
