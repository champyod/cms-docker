//! The one `__domain.sh renew` argv encoder.
//!
//! WHY renew needs its own encoder rather than a mode flag on `domain_setup_args`: the
//! two verbs accept different flags. `setup` takes `--cert-path`/`--key-path` to install
//! a supplied certificate and `--auto-renew` to trigger a renewal from inside a setup
//! run, while `renew` takes `--due` to narrow itself. `cmd_renew` reaches neither
//! `install_supplied_certificate` nor `_run_auto_renew`, so a shared request type would
//! put flags on the wire that the renew path parses and then ignores — the operator
//! would have typed `--auto-renew` on a verb whose entire job is the renewal.
//!
//! WHY [`DomainRetryPolicy`] and `retry_args` are imported rather than redeclared: the
//! script's own help heads the retry group "Retry options (setup, renew)". A second copy
//! is free to drift. The run switches are the exception — see [`DomainRenewSwitches`],
//! which exists precisely because renew does not accept the same three.

use crate::core::domain_setup::{retry_args, DomainRetryPolicy};

/// The run switches `renew` shares with `setup`, minus the one it answers by default.
///
/// WHY this is not [`crate::core::domain_setup::DomainSwitches`]: that struct carries
/// `--force`, and renew force-renews whether or not the operator asks, so the field would
/// be a value the encoder could only ignore. Making the omission structural here means no
/// renew request can carry a flag that changes nothing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainRenewSwitches {
    /// Passes `--staging` (the untrusted Let's Encrypt test CA).
    pub is_staging: bool,
    /// Passes `--lock` so a flock serialises overlapping renewals.
    pub is_lock: bool,
}

/// Every value `scripts/__domain.sh renew` accepts, before it becomes argv.
///
/// Owned rather than borrowed for the reason [`crate::core::domain_setup::DomainSetupRequest`]
/// is: the TUI form assembles it from live field state while the CLI holds references
/// into its clap-parsed command.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DomainRenewRequest {
    /// `--cert`: `letsencrypt`, `provided` or `selfsigned`.
    pub cert: String,
    pub domain: String,
    pub admin_domain: String,
    pub oj_domain: String,
    pub ranking_domain: String,
    pub email: String,
    /// `--wait-port80`: seconds to wait for :80 before issuing; `0` means no wait.
    pub wait_port80: Option<u32>,
    pub extra_domains: String,
    pub dns: String,
    pub dns_credentials: String,
    /// `--challenge`; blank leaves `ACME_CHALLENGE` in force.
    pub challenge: String,
    /// `--ca`; blank leaves `ACME_CA` in force.
    pub ca: String,
    /// `--acme-server`; blank leaves `ACME_DIRECTORY_URL` in force.
    pub acme_server: String,
    /// `--acme-client`; blank leaves `ACME_CLIENT` in force.
    pub acme_client: String,
    /// `--tls-address`; blank leaves `ACME_TLS_ALPN_ADDRESS` in force.
    pub tls_address: String,
    /// The run switches, shared with `setup` except for the one renew answers by default.
    pub switches: DomainRenewSwitches,
    /// The retry controls, as one policy.
    pub retry: DomainRetryPolicy,
    pub deploy_hook: String,
    /// Passes `--due`: renew only what the CA reports as due.
    pub is_due: bool,
    /// Passes `--apply`; without it `cmd_renew` prints its dry-run line and returns.
    pub is_apply: bool,
    /// Passes `--backup-certs` to snapshot the cert store first.
    ///
    /// WHY this is a bare field rather than the [`crate::domain_setup::DomainStorePolicy`]
    /// that `setup` uses: that struct's second half is `--auto-renew`, which `renew` must
    /// never accept. A separate field makes the omission structural.
    pub is_backup_certs: bool,
}

/// Reads a flag value off a renew request, treating blank as "not given".
type ValueFlagFn = fn(&DomainRenewRequest) -> Option<String>;

/// Reads a flag-only switch off a renew request.
type BoolFlagFn = fn(&DomainRenewRequest) -> bool;

/// Every value-valued flag, in the order the script documents them.
///
/// WHY a table rather than repeated pushes: the order here is the order the operator
/// sees in `--help` and in the CLI test assertions, and one list is the only place that
/// order is written down.
const VALUE_FLAGS: [(&str, ValueFlagFn); 15] = [
    ("--domain", |r| opt_str(&r.domain)),
    ("--admin-domain", |r| opt_str(&r.admin_domain)),
    ("--oj-domain", |r| opt_str(&r.oj_domain)),
    ("--ranking-domain", |r| opt_str(&r.ranking_domain)),
    ("--email", |r| opt_str(&r.email)),
    ("--wait-port80", |r| r.wait_port80.map(|v| v.to_string())),
    ("--extra-domains", |r| opt_str(&r.extra_domains)),
    ("--dns", |r| opt_str(&r.dns)),
    ("--dns-credentials", |r| opt_str(&r.dns_credentials)),
    ("--challenge", |r| opt_str(&r.challenge)),
    ("--ca", |r| opt_str(&r.ca)),
    ("--acme-server", |r| opt_str(&r.acme_server)),
    ("--acme-client", |r| opt_str(&r.acme_client)),
    ("--tls-address", |r| opt_str(&r.tls_address)),
    ("--deploy-hook", |r| opt_str(&r.deploy_hook)),
];

/// A blank string means "flag not given", so it never reaches argv.
///
/// WHY `None` rather than an empty argument: `__domain.sh` reads a present-but-empty
/// value as an explicit empty domain, which is not the same as leaving the flag out.
///
/// WHY this repeats the helper `domain_setup` already has instead of sharing it: the two
/// encoders read different request types, and exporting a one-line `is_empty` check
/// across the boundary would cost more than the duplication it removes.
fn opt_str(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

/// The flag-only flags, emitted in the order the CLI has always emitted them.
///
/// WHY `--due` leads and `--force` is absent: `build_renew_flags` adds `--force-renewal`
/// unless `RENEW_DUE_ONLY` is set, so `renew` force-renews by default and `--due` is the
/// one switch that withholds that. A `--force` here would name a choice the verb has
/// already made — and because `--due` overrides the default, it could only ever have meant
/// "force despite `--due`", which is a second spelling of the flag's own absence rather than
/// a fact about this verb. `--force` stays on `setup`/`cert`, where `FORCE_RENEWAL` is
/// actually read by `build_certbot_flags`.
const BOOL_FLAGS: [(&str, BoolFlagFn); 4] = [
    ("--due", |r| r.is_due),
    ("--staging", |r| r.switches.is_staging),
    ("--backup-certs", |r| r.is_backup_certs),
    ("--lock", |r| r.switches.is_lock),
];

/// Encodes a renew request as the argv `scripts/__domain.sh` expects.
///
/// # Panics
///
/// Never: the flag tables are constants and every value read is borrowed from the
/// input struct, so a request always produces argv rather than failing.
#[must_use]
pub fn domain_renew_args(renew: &DomainRenewRequest) -> Vec<String> {
    let mut out = vec!["renew".to_string()];
    // An empty cert must reach the script as the absence of --cert so DOMAIN_CERT_METHOD applies.
    if !renew.cert.is_empty() {
        out.push("--cert".to_string());
        out.push(renew.cert.clone());
    }

    for (flag, field) in VALUE_FLAGS {
        if let Some(value) = field(renew) {
            out.push(flag.to_string());
            out.push(value);
        }
    }
    out.extend(retry_args(&renew.retry));
    for (flag, field) in BOOL_FLAGS {
        if field(renew) {
            out.push(flag.to_string());
        }
    }
    if renew.is_apply {
        out.push("--apply".to_string());
    }
    out
}

#[cfg(test)]
#[path = "domain_renew_tests.rs"]
mod tests;
