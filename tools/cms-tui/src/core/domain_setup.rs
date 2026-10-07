//! The one `__domain.sh setup` argv encoder, shared by the CLI and the TUI form.
//!
//! WHY this lives in `core` rather than in `cli::resolve`: the TUI domain form reaches
//! the same script with the same flags, and a second encoder is how the two paths end
//! up disagreeing about what "retry forever" means. Both frontends build the same
//! [`DomainSetupRequest`] struct and hand it to [`domain_setup_args`].

/// The three retry controls, which only ever mean something together.
///
/// WHY a nested struct rather than three loose fields: a struct carrying more than
/// three bare booleans reads as a bag of unrelated switches, and these three are one
/// policy — "retry, up to N times, waiting S seconds" — so naming the group keeps that
/// relationship visible instead of implied by field order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainRetryPolicy {
    /// Passes `--auto-retry`.
    pub is_auto_retry: bool,
    /// Retry with no cap; encoded as `--auto-retry` plus a zero attempt cap.
    pub is_retry_forever: bool,
    /// `--retry-attempts`; `0` is the script's "no cap" sentinel.
    pub attempts: Option<u32>,
    /// `--retry-interval`, the delay before the first retry.
    pub interval: Option<u32>,
}

/// The flag-only switches that change how issuance runs, not what it issues.
///
/// WHY `backup_certs` and `auto_renew` live in [`DomainStorePolicy`] instead: those two
/// are about what happens to the stored certificate around the run, while these three
/// are about the run itself, and keeping them together here is what stops a fourth
/// unrelated switch arriving without anyone noticing it no longer has a home.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainSwitches {
    /// Passes `--staging` (the untrusted Let's Encrypt test CA).
    pub is_staging: bool,
    /// Passes `--force` to reissue a still-valid certificate.
    pub is_force: bool,
    /// Passes `--lock` so a flock serialises overlapping runs.
    pub is_lock: bool,
}

/// What happens to the certificate store around a run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainStorePolicy {
    /// Passes `--backup-certs` to snapshot the cert store first.
    pub is_backup_certs: bool,
    /// Passes `--auto-renew` so a live run ends by forcing a renewal.
    pub is_auto_renew: bool,
}

/// Which half of `setup` a request covers.
///
/// WHY this is an enum rather than two booleans: `--cert-only` and `--proxy-only` are
/// the same single choice, so two independent flags could describe a request that no
/// operator can mean.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum DomainScope {
    /// The whole of `setup`: issue the certificate and render nginx, emitting neither
    /// scope flag.
    #[default]
    Both,
    /// Passes `--cert-only`: issue the certificate and leave nginx alone.
    CertOnly,
    /// Passes `--proxy-only`: render and reload nginx and leave the cert store alone.
    ProxyOnly,
    /// Passes both scope flags, exactly as the operator typed them.
    ///
    /// WHY this is representable instead of being resolved here: the CLI forwards what
    /// was written and `__domain.sh` is the authority that refuses the pair. Picking
    /// either half would turn a parse error into a run that quietly skips work the
    /// operator asked for.
    BothNarrowed,
}

/// Reads the two scope flags off a request as the single scope they name.
///
/// Total over all four combinations, so no pair of flags can be dropped or guessed at
/// on the way to the encoder.
#[must_use]
pub const fn scope_from(cert_only: bool, proxy_only: bool) -> DomainScope {
    match (cert_only, proxy_only) {
        (false, false) => DomainScope::Both,
        (true, false) => DomainScope::CertOnly,
        (false, true) => DomainScope::ProxyOnly,
        (true, true) => DomainScope::BothNarrowed,
    }
}

/// Every value `scripts/__domain.sh setup` accepts, before it becomes argv.
///
/// Owned rather than borrowed because the TUI form assembles it from live field state
/// while the CLI holds references into its clap-parsed command.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DomainSetupRequest {
    /// `--cert`: `letsencrypt`, `provided` or `selfsigned`.
    pub cert: String,
    pub domain: String,
    pub admin_domain: String,
    pub oj_domain: String,
    pub ranking_domain: String,
    pub cert_path: String,
    pub key_path: String,
    pub email: String,
    /// The scope the request narrows to, as one choice rather than two flags.
    pub scope: DomainScope,
    /// Passes `--apply`; without it the script only prints a dry-run plan.
    pub is_apply: bool,
    /// Passes `--yes` so the script does not prompt for optional features.
    pub is_yes: bool,
    /// The retry controls, as one policy.
    pub retry: DomainRetryPolicy,
    /// `--wait-port80`: seconds to wait for :80 before issuing; `0` means no wait.
    pub wait_port80: Option<u32>,
    pub extra_domains: String,
    pub dns: String,
    pub dns_credentials: String,
    /// The three switches that change how the run itself behaves.
    pub switches: DomainSwitches,
    /// What happens to the certificate store around the run.
    pub store: DomainStorePolicy,
    pub deploy_hook: String,
}

/// The `DomainCertMethod` value used when nothing has been chosen yet.
pub const DEFAULT_CERT_METHOD: &str = "letsencrypt";

/// The attempt cap `__domain.sh` uses when `CERT_RETRY_ATTEMPTS` is unset.
pub const DEFAULT_RETRY_ATTEMPTS: u32 = 8;

/// The first-retry delay `__domain.sh` uses when `CERT_RETRY_INTERVAL` is unset.
pub const DEFAULT_RETRY_INTERVAL: u32 = 15;

/// Reads a flag value off a setup request, treating blank as "not given".
type ValueFlagFn = fn(&DomainSetupRequest) -> Option<String>;

/// Reads a flag-only switch off a setup request.
type BoolFlagFn = fn(&DomainSetupRequest) -> bool;

/// Every value-valued flag, in the order the script documents them.
///
/// WHY a table rather than repeated pushes: the order here is the order the operator
/// sees in `--help` and in the CLI test assertions, and one list is the only place that
/// order is written down.
const VALUE_FLAGS: [(&str, ValueFlagFn); 12] = [
    ("--domain", |s| opt_str(&s.domain)),
    ("--admin-domain", |s| opt_str(&s.admin_domain)),
    ("--oj-domain", |s| opt_str(&s.oj_domain)),
    ("--ranking-domain", |s| opt_str(&s.ranking_domain)),
    ("--cert-path", |s| opt_str(&s.cert_path)),
    ("--key-path", |s| opt_str(&s.key_path)),
    ("--email", |s| opt_str(&s.email)),
    ("--wait-port80", |s| s.wait_port80.map(|v| v.to_string())),
    ("--extra-domains", |s| opt_str(&s.extra_domains)),
    ("--dns", |s| opt_str(&s.dns)),
    ("--dns-credentials", |s| opt_str(&s.dns_credentials)),
    ("--deploy-hook", |s| opt_str(&s.deploy_hook)),
];

/// A blank string means "flag not given", so it never reaches argv.
///
/// WHY `None` rather than an empty argument: `__domain.sh` reads a present-but-empty
/// value as an explicit empty domain, which is not the same as leaving the flag out.
fn opt_str(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

/// The flag-only flags, emitted in the order the CLI has always emitted them.
///
/// WHY this stays one table even though the switches now live in two structs: the
/// order here is the order the script's own help lists and the order the CLI test
/// assertions pin, and the two flags split into [`DomainStorePolicy`] interleave with
/// the other three. One list is the only place that order is written down.
const BOOL_FLAGS: [(&str, BoolFlagFn); 5] = [
    ("--staging", |s| s.switches.is_staging),
    ("--force", |s| s.switches.is_force),
    ("--backup-certs", |s| s.store.is_backup_certs),
    ("--lock", |s| s.switches.is_lock),
    ("--auto-renew", |s| s.store.is_auto_renew),
];

/// Encodes a setup request as the argv `scripts/__domain.sh` expects.
///
/// # Panics
///
/// Never: the flag tables are constants and every value read is borrowed from the
/// input struct, so a request always produces argv rather than failing.
#[must_use]
pub fn domain_setup_args(verb: &str, setup: &DomainSetupRequest) -> Vec<String> {
    let cert = if setup.cert.is_empty() {
        DEFAULT_CERT_METHOD
    } else {
        setup.cert.as_str()
    };
    let mut out = vec![verb.to_string(), "--cert".to_string(), cert.to_string()];

    for (flag, field) in VALUE_FLAGS {
        if let Some(value) = field(setup) {
            out.push(flag.to_string());
            out.push(value);
        }
    }
    out.extend(retry_args(setup));
    for (flag, field) in BOOL_FLAGS {
        if field(setup) {
            out.push(flag.to_string());
        }
    }
    // WHY the scope pair trails the other booleans instead of joining BOOL_FLAGS: the
    // script rejects both together at parse time, so they have to be recognisable as
    // one choice rather than as two unrelated run-mode switches.
    match setup.scope {
        DomainScope::Both => {}
        DomainScope::CertOnly => out.push("--cert-only".to_string()),
        DomainScope::ProxyOnly => out.push("--proxy-only".to_string()),
        DomainScope::BothNarrowed => {
            out.push("--cert-only".to_string());
            out.push("--proxy-only".to_string());
        }
    }
    if setup.is_apply {
        out.push("--apply".to_string());
    }
    if setup.is_yes {
        out.push("--yes".to_string());
    }
    out
}

/// The three retry flags, in the CLI's established order.
///
/// WHY `--retry-forever` is expanded here and not forwarded as a bare flag: the script
/// reads an unlimited run as `--auto-retry` with `--retry-attempts 0`, so forwarding the
/// name alone would leave the default cap of 8 in force.
fn retry_args(setup: &DomainSetupRequest) -> Vec<String> {
    let mut out = Vec::new();
    if setup.retry.is_auto_retry || setup.retry.is_retry_forever {
        out.push("--auto-retry".to_string());
    }
    let attempts = if setup.retry.is_retry_forever {
        Some(0)
    } else {
        setup.retry.attempts
    };
    if let Some(attempts) = attempts {
        out.push("--retry-attempts".to_string());
        out.push(attempts.to_string());
    }
    if let Some(interval) = setup.retry.interval {
        out.push("--retry-interval".to_string());
        out.push(interval.to_string());
    }
    out
}

#[cfg(test)]
#[path = "domain_setup_tests.rs"]
mod tests;
