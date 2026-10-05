//! The one `__domain.sh` argv encoder, shared by the CLI and the TUI domain form.
//!
//! WHY this lives in `core` and not in `cli::resolve`: the TUI form reaches the same
//! script with the same flags, and a second encoder is how the two frontends end up
//! disagreeing about which flags exist at all. `cli::domain_args` converts clap's parsed
//! flags into a [`DomainSetupRequest`]; the TUI converts its form rows into the same
//! struct; both hand it to [`domain_setup_args`].
//!
//! WHY the flag tables below name every flag once: a flag the encoder can forget and a
//! flag the script still reads cannot both be caught by a test that builds argv here,
//! because such a test never reads the script's own `case` arms.

/// The `--cert` value used when the caller named none, matching the script's own default.
pub const DEFAULT_CERT_METHOD: &str = "letsencrypt";

/// The certificate-method flag, always sent because the script scopes a run by it.
const CERT_FLAG: &str = "--cert";

/// The retry counters, which only ever mean something together.
///
/// WHY a named group rather than four loose fields: these describe one policy — "retry,
/// up to N times, waiting S seconds" — and naming the group keeps that relationship
/// visible instead of implied by field order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainRetryPolicy {
    /// Passes `--auto-retry`.
    pub is_auto_retry: bool,
    /// Passes `--retry-forever`.
    pub is_retry_forever: bool,
    /// `--retry-attempts`.
    pub attempts: Option<u32>,
    /// `--retry-interval`, the delay before the first retry.
    pub interval: Option<u32>,
}

/// The switches that change how issuance runs without changing what it issues.
///
/// WHY one struct holding five flags rather than five loose fields: they are a single
/// choice — "how this run behaves" — and the encoder reads them as a group, so the grouping
/// makes it visible that none of them can be interpreted without the others.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainSwitches {
    /// Passes `--staging`, the untrusted Let's Encrypt test CA.
    pub is_staging: bool,
    /// Passes `--force` to reissue a still-valid certificate.
    pub is_force: bool,
    /// Passes `--backup-certs` to snapshot the cert store first.
    pub is_backup_certs: bool,
    /// Passes `--lock` so a flock serialises overlapping runs.
    pub is_lock: bool,
    /// Passes `--json` so the script prints machine-readable output.
    pub is_json: bool,
}

/// Whether the run prints a plan or performs the change.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DomainMode {
    /// Passes `--dry-run`.
    ///
    /// WHY it is emitted before `--apply` and both are kept: the script resolves the pair
    /// in argv order, so a caller who set both ends up applying rather than silently
    /// getting a dry run it did not ask for.
    pub is_dry_run: bool,
    /// Passes `--apply`.
    pub is_apply: bool,
    /// Passes `--yes` so the script does not prompt for optional features.
    pub is_yes: bool,
}

/// Every value `scripts/__domain.sh` reads for a setup-scope verb, before it becomes argv.
///
/// Owned rather than borrowed because the TUI form assembles it from live field state
/// while the CLI holds references into its clap-parsed command.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DomainSetupRequest {
    /// `--cert`: `letsencrypt`, `provided` or `selfsigned`.
    pub cert: String,
    pub domain: Option<String>,
    pub admin_domain: Option<String>,
    pub oj_domain: Option<String>,
    pub ranking_domain: Option<String>,
    pub cert_path: Option<String>,
    pub key_path: Option<String>,
    pub email: Option<String>,
    pub extra_domains: Option<String>,
    pub dns: Option<String>,
    pub dns_credentials: Option<String>,
    pub deploy_hook: Option<String>,
    /// `--config`, the alternate env file.
    pub config: Option<String>,
    /// `--reason`, the revocation reason.
    ///
    /// WHY this belongs on the shared request rather than only on `revoke`: the script
    /// parses one flag set for every verb, so the CLI forwards a reason it was given
    /// after `setup` too, and the form must be able to produce the same argv.
    pub reason: Option<String>,
    /// `--days`, the expiry threshold for `check-expiry`.
    ///
    /// WHY here for the same reason as `reason`: one parse block, one flag set.
    pub days: Option<u32>,
    pub wait_port80: Option<u32>,
    /// The retry policy, as one group.
    pub retry: DomainRetryPolicy,
    /// The run-mode switches.
    pub switches: DomainSwitches,
    /// Whether this is a plan or a change.
    pub mode: DomainMode,
}

/// Reads a value-valued flag off a request.
type ValueFlag = (&'static str, fn(&DomainSetupRequest) -> Option<String>);

/// Reads a number-valued flag off a request, rendered the way the script parses it.
type NumberFlag = (&'static str, fn(&DomainSetupRequest) -> Option<String>);

/// Reads a flag-only switch off a request.
type SwitchFlag = (&'static str, fn(&DomainSetupRequest) -> bool);

/// The value flags, in the order argv has always carried them.
///
/// WHY a table rather than repeated pushes: this order is what the CLI's argv
/// assertions pin, and one list is the only place that order is written down.
const VALUE_FLAGS: [ValueFlag; 13] = [
    ("--domain", |s| s.domain.clone()),
    ("--admin-domain", |s| s.admin_domain.clone()),
    ("--oj-domain", |s| s.oj_domain.clone()),
    ("--ranking-domain", |s| s.ranking_domain.clone()),
    ("--cert-path", |s| s.cert_path.clone()),
    ("--key-path", |s| s.key_path.clone()),
    ("--email", |s| s.email.clone()),
    ("--extra-domains", |s| s.extra_domains.clone()),
    ("--deploy-hook", |s| s.deploy_hook.clone()),
    ("--reason", |s| s.reason.clone()),
    ("--dns", |s| s.dns.clone()),
    ("--dns-credentials", |s| s.dns_credentials.clone()),
    ("--config", |s| s.config.clone()),
];

/// The number flags, in the order argv has always carried them.
const NUMBER_FLAGS: [NumberFlag; 4] = [
    ("--retry-attempts", |s| number(s.retry.attempts)),
    ("--retry-interval", |s| number(s.retry.interval)),
    ("--wait-port80", |s| number(s.wait_port80)),
    ("--days", |s| number(s.days)),
];

/// The flag-only switches, in the order argv has always carried them.
const SWITCH_FLAGS: [SwitchFlag; 10] = [
    ("--dry-run", |s| s.mode.is_dry_run),
    ("--apply", |s| s.mode.is_apply),
    ("--yes", |s| s.mode.is_yes),
    ("--auto-retry", |s| s.retry.is_auto_retry),
    ("--retry-forever", |s| s.retry.is_retry_forever),
    ("--staging", |s| s.switches.is_staging),
    ("--force", |s| s.switches.is_force),
    ("--backup-certs", |s| s.switches.is_backup_certs),
    ("--lock", |s| s.switches.is_lock),
    ("--json", |s| s.switches.is_json),
];

/// Renders a number flag's value, which the script reads as a bare non-negative integer.
fn number(value: Option<u32>) -> Option<String> {
    value.map(|digits| digits.to_string())
}

/// The `--cert` value to send, substituting the script's own default for a blank row.
fn cert_method(setup: &DomainSetupRequest) -> String {
    if setup.cert.trim().is_empty() {
        DEFAULT_CERT_METHOD.to_string()
    } else {
        setup.cert.trim().to_string()
    }
}

/// Appends `flag value` for every flag whose reader returned one.
fn push_values(out: &mut Vec<String>, setup: &DomainSetupRequest) {
    for (flag, read) in VALUE_FLAGS {
        if let Some(value) = read(setup) {
            out.push(flag.to_string());
            out.push(value);
        }
    }
    for (flag, read) in NUMBER_FLAGS {
        if let Some(value) = read(setup) {
            out.push(flag.to_string());
            out.push(value);
        }
    }
}

/// Encodes a setup request as the argv `scripts/__domain.sh` expects.
///
/// `verb` travels first because the script reads it before it reads any flag: the scope
/// of the run is decided by which command was named, not by anything that follows it.
///
/// # Panics
///
/// Never: the flag tables are constants and every value read is cloned out of the input
/// struct, so a request always produces argv rather than failing.
#[must_use]
pub fn domain_setup_args(verb: &str, setup: &DomainSetupRequest) -> Vec<String> {
    let mut out = vec![verb.to_string(), CERT_FLAG.to_string(), cert_method(setup)];
    push_values(&mut out, setup);
    for (flag, read) in SWITCH_FLAGS {
        if read(setup) {
            out.push(flag.to_string());
        }
    }
    out
}

/// Every flag name the encoder can emit, for the drift test that pins the set.
///
/// WHY `--cert` is listed here rather than read off a table: it is emitted ahead of
/// every table, because the script reads it before it reads anything else, and a name
/// list that quietly omitted it would let the form drop the one flag a run cannot go
/// without.
///
/// WHY this is exposed: a test that compares the encoder's flag names against the
/// script's parse block catches a flag added to one and not the other, which no
/// argv assertion can see.
#[must_use]
pub fn emitted_flag_names() -> Vec<&'static str> {
    let value = VALUE_FLAGS.iter().map(|(flag, _)| *flag);
    let number = NUMBER_FLAGS.iter().map(|(flag, _)| *flag);
    let switches = SWITCH_FLAGS.iter().map(|(flag, _)| *flag);
    std::iter::once(CERT_FLAG)
        .chain(value)
        .chain(number)
        .chain(switches)
        .collect()
}

#[cfg(test)]
#[path = "domain_setup_tests.rs"]
mod tests;
