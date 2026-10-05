//! Flag set for the domain setup scope, mirroring the parse block of
//! `scripts/__domain.sh`.
//!
//! WHY one shared struct rather than a struct per verb: `setup`, `cert` and
//! `proxy` are read by the same parse loop, so a flag the script understands
//! but the CLI cannot forward would be rejected by the script's
//! unknown-option branch. Every flag it reads is declared here once.

use crate::core::domain_setup::{
    domain_setup_args, DomainMode, DomainRetryPolicy, DomainSetupRequest, DomainSwitches,
};
use clap::Args;

/// Every flag `scripts/__domain.sh` accepts, in the order its usage text and
/// parse block list them.
#[derive(Args, Clone, Debug)]
pub struct DomainSetupFlags {
    /// Certificate type (letsencrypt|provided|selfsigned).
    #[arg(long, default_value = "letsencrypt")]
    pub cert: String,
    /// Primary domain (default from the env file).
    #[arg(long)]
    pub domain: Option<String>,
    /// Admin subdomain.
    #[arg(long)]
    pub admin_domain: Option<String>,
    /// OJ subdomain.
    #[arg(long)]
    pub oj_domain: Option<String>,
    /// Ranking subdomain.
    #[arg(long)]
    pub ranking_domain: Option<String>,
    /// Path to fullchain.pem (required for `--cert provided`).
    #[arg(long)]
    pub cert_path: Option<String>,
    /// Path to privkey.pem (required for `--cert provided`).
    #[arg(long)]
    pub key_path: Option<String>,
    /// Email for Let's Encrypt registration (required for letsencrypt).
    #[arg(long)]
    pub email: Option<String>,
    /// Print actions without executing (the script default).
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
    /// Actually execute changes.
    #[arg(long, default_value_t = false)]
    pub apply: bool,
    /// Skip optional feature prompts.
    #[arg(long, short = 'y', default_value_t = false)]
    pub yes: bool,
    /// Retry certificate issuance with backoff.
    #[arg(long, default_value_t = false)]
    pub auto_retry: bool,
    /// Maximum issuance attempts with `--auto-retry`.
    #[arg(long)]
    pub retry_attempts: Option<u32>,
    /// First retry delay in seconds; doubles up to 120s.
    #[arg(long)]
    pub retry_interval: Option<u32>,
    /// Retry with no attempt limit (implies `--auto-retry`).
    #[arg(long, default_value_t = false)]
    pub retry_forever: bool,
    /// Extra SANs, space-separated, added to the certificate.
    #[arg(long)]
    pub extra_domains: Option<String>,
    /// Run this command after a successful issue or renewal.
    #[arg(long)]
    pub deploy_hook: Option<String>,
    /// Use the Let's Encrypt staging CA (untrusted certificates).
    #[arg(long, default_value_t = false)]
    pub staging: bool,
    /// Re-issue even when the current certificate is valid.
    #[arg(long, default_value_t = false)]
    pub force: bool,
    /// Seconds to wait for HTTP :80 to answer before issuing.
    #[arg(long)]
    pub wait_port80: Option<u32>,
    /// Snapshot the certificate store before changes.
    #[arg(long, default_value_t = false)]
    pub backup_certs: bool,
    /// Serialise runs with flock.
    #[arg(long, default_value_t = false)]
    pub lock: bool,
    /// Emit machine-readable output.
    #[arg(long, default_value_t = false)]
    pub json: bool,
    /// Expiry threshold in days for `check-expiry`.
    #[arg(long)]
    pub days: Option<u32>,
    /// Revocation reason for `revoke`.
    #[arg(long)]
    pub reason: Option<String>,
    /// DNS-01 challenge provider instead of HTTP-01 webroot.
    #[arg(long)]
    pub dns: Option<String>,
    /// Plugin credentials ini for the DNS-01 challenge.
    #[arg(long)]
    pub dns_credentials: Option<String>,
    /// Alternate env file instead of ./.env.
    #[arg(long)]
    pub config: Option<String>,
}

/// Projects clap's parsed flags onto the request the shared encoder reads.
///
/// WHY a projection rather than a second encoder: the TUI domain form builds the same
/// struct from its live field state, and both frontends then call
/// [`domain_setup_args`]. Two encoders are how "retry forever" ends up meaning one thing
/// on the command line and another in the interface.
fn to_request(flags: &DomainSetupFlags) -> DomainSetupRequest {
    DomainSetupRequest {
        cert: flags.cert.clone(),
        domain: flags.domain.clone(),
        admin_domain: flags.admin_domain.clone(),
        oj_domain: flags.oj_domain.clone(),
        ranking_domain: flags.ranking_domain.clone(),
        cert_path: flags.cert_path.clone(),
        key_path: flags.key_path.clone(),
        email: flags.email.clone(),
        extra_domains: flags.extra_domains.clone(),
        dns: flags.dns.clone(),
        dns_credentials: flags.dns_credentials.clone(),
        deploy_hook: flags.deploy_hook.clone(),
        config: flags.config.clone(),
        reason: flags.reason.clone(),
        days: flags.days,
        wait_port80: flags.wait_port80,
        retry: DomainRetryPolicy {
            is_auto_retry: flags.auto_retry,
            is_retry_forever: flags.retry_forever,
            attempts: flags.retry_attempts,
            interval: flags.retry_interval,
        },
        switches: DomainSwitches {
            is_staging: flags.staging,
            is_force: flags.force,
            is_backup_certs: flags.backup_certs,
            is_lock: flags.lock,
            is_json: flags.json,
        },
        mode: DomainMode {
            is_dry_run: flags.dry_run,
            is_apply: flags.apply,
            is_yes: flags.yes,
        },
    }
}

/// Builds the argv for `verb` out of `flags`, omitting every flag the caller
/// left unset so the script keeps applying its own defaults.
pub(super) fn setup_args(verb: &str, flags: &DomainSetupFlags) -> Vec<String> {
    domain_setup_args(verb, &to_request(flags))
}
