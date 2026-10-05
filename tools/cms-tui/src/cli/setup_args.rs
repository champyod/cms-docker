//! The flag payload behind `cms domain setup`.
//!
//! WHY this is its own type instead of inline fields on the subcommand: the 23 flags
//! make the payload three hundred bytes wide, so keeping it inline would drag both
//! `DomainCmd` and the outer `Commands` enum up to that size. One box keeps every
//! enum pointer-sized.

use clap::Args;

/// Every flag `scripts/__domain.sh setup` accepts, as parsed from argv.
///
/// The values stay `Option`/`bool` here so clap keeps "not typed" distinct from
/// "typed as 0"; `cli::resolve` performs the single projection onto
/// [`crate::core::domain_setup::DomainSetupRequest`].
#[derive(Args, Clone, Debug)]
pub struct DomainSetupArgs {
    /// Certificate type (letsencrypt|provided|selfsigned).
    #[arg(long, default_value = "letsencrypt")]
    pub cert: String,
    /// Primary domain (default from `DOMAIN_NAME` env).
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
    /// Path to fullchain.pem (required for --cert provided).
    #[arg(long)]
    pub cert_path: Option<String>,
    /// Path to privkey.pem (required for --cert provided).
    #[arg(long)]
    pub key_path: Option<String>,
    /// Email for Let's Encrypt registration (required for letsencrypt).
    #[arg(long)]
    pub email: Option<String>,
    /// Issue the certificate only; nginx is not rendered, validated or reloaded.
    #[arg(long, default_value_t = false)]
    pub cert_only: bool,
    /// Render, validate and reload nginx only; the certificate store is untouched.
    #[arg(long, default_value_t = false)]
    pub proxy_only: bool,
    /// Actually execute changes (default: dry-run, prints only).
    #[arg(long, default_value_t = false)]
    pub apply: bool,
    /// Skip optional feature prompts.
    #[arg(long, short = 'y', default_value_t = false)]
    pub yes: bool,
    /// Retry issuance instead of returning the first failure.
    #[arg(long, default_value_t = false)]
    pub auto_retry: bool,
    /// Retry cap; 0 means unlimited.
    #[arg(long)]
    pub retry_attempts: Option<u32>,
    /// Seconds before the first retry; doubles each attempt up to 120.
    #[arg(long)]
    pub retry_interval: Option<u32>,
    /// Retry without an attempt cap (implies --auto-retry).
    #[arg(long, default_value_t = false)]
    pub retry_forever: bool,
    /// Wait for :80 to answer before requesting the certificate.
    #[arg(long)]
    pub wait_port80: Option<u32>,
    /// Extra SAN hostnames, space separated.
    #[arg(long)]
    pub extra_domains: Option<String>,
    /// DNS-01 provider (e.g. cloudflare); empty keeps HTTP-01.
    #[arg(long)]
    pub dns: Option<String>,
    /// Credential file for the DNS-01 plugin.
    #[arg(long)]
    pub dns_credentials: Option<String>,
    /// Use the Let's Encrypt test CA.
    #[arg(long, default_value_t = false)]
    pub staging: bool,
    /// Command run after a successful renewal.
    #[arg(long)]
    pub deploy_hook: Option<String>,
    /// Reissue even if the current certificate is still valid.
    #[arg(long, default_value_t = false)]
    pub force: bool,
    /// Back up the certificate store before replacing it.
    #[arg(long, default_value_t = false)]
    pub backup_certs: bool,
    /// Hold a flock so overlapping runs cannot collide.
    #[arg(long, default_value_t = false)]
    pub lock: bool,
    /// End a live run by forcing a renewal.
    #[arg(long, default_value_t = false)]
    pub auto_renew: bool,
}
