//! Flag set for the domain setup scope, mirroring the parse block of
//! `scripts/__domain.sh`.
//!
//! WHY one shared struct rather than a struct per verb: `setup`, `cert` and
//! `proxy` are read by the same parse loop, so a flag the script understands
//! but the CLI cannot forward would be rejected by the script's
//! unknown-option branch. Every flag it reads is declared here once.

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

/// Builds the argv for `verb` out of `flags`, omitting every flag the caller
/// left unset so the script keeps applying its own defaults.
pub(super) fn setup_args(verb: &str, flags: &DomainSetupFlags) -> Vec<String> {
    let mut out = vec![verb.to_string(), "--cert".into(), flags.cert.clone()];
    push_value_flags(&mut out, flags);
    push_number_flags(&mut out, flags);
    push_switches(&mut out, flags);
    out
}

fn push_value_flags(out: &mut Vec<String>, flags: &DomainSetupFlags) {
    for (flag, value) in [
        ("--domain", flags.domain.as_deref()),
        ("--admin-domain", flags.admin_domain.as_deref()),
        ("--oj-domain", flags.oj_domain.as_deref()),
        ("--ranking-domain", flags.ranking_domain.as_deref()),
        ("--cert-path", flags.cert_path.as_deref()),
        ("--key-path", flags.key_path.as_deref()),
        ("--email", flags.email.as_deref()),
        ("--extra-domains", flags.extra_domains.as_deref()),
        ("--deploy-hook", flags.deploy_hook.as_deref()),
        ("--reason", flags.reason.as_deref()),
        ("--dns", flags.dns.as_deref()),
        ("--dns-credentials", flags.dns_credentials.as_deref()),
        ("--config", flags.config.as_deref()),
    ] {
        if let Some(value) = value {
            out.push(flag.to_string());
            out.push(value.to_string());
        }
    }
}

fn push_number_flags(out: &mut Vec<String>, flags: &DomainSetupFlags) {
    for (flag, value) in [
        ("--retry-attempts", flags.retry_attempts),
        ("--retry-interval", flags.retry_interval),
        ("--wait-port80", flags.wait_port80),
        ("--days", flags.days),
    ] {
        if let Some(value) = value {
            out.push(flag.to_string());
            out.push(value.to_string());
        }
    }
}

/// WHY `--dry-run` is emitted before `--apply`: the script resolves the pair in
/// argv order, so a caller who passed both ends up applying rather than being
/// rejected by a rule the script itself does not have.
fn push_switches(out: &mut Vec<String>, flags: &DomainSetupFlags) {
    for (flag, is_set) in [
        ("--dry-run", flags.dry_run),
        ("--apply", flags.apply),
        ("--yes", flags.yes),
        ("--auto-retry", flags.auto_retry),
        ("--retry-forever", flags.retry_forever),
        ("--staging", flags.staging),
        ("--force", flags.force),
        ("--backup-certs", flags.backup_certs),
        ("--lock", flags.lock),
        ("--json", flags.json),
    ] {
        if is_set {
            out.push(flag.to_string());
        }
    }
}
