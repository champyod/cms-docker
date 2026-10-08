//! The flag payload behind `cms domain setup`.
//!
//! WHY this is its own type instead of inline fields on the subcommand: the 23 flags
//! make the payload three hundred bytes wide, so keeping it inline would drag both
//! `DomainCmd` and the outer `Commands` enum up to that size. One box keeps every
//! enum pointer-sized.
//!
//! WHY the flags arrive in five flattened groups rather than as one flat list: each
//! group is a decision the operator makes together, and a flat list of eleven bare
//! booleans gives no way to see which flags belong to which decision. Flattening keeps
//! the command line byte-for-byte identical while making the grouping visible in the
//! struct, which is where the projection in `cli::resolve` reads it.

use clap::Args;

/// Which half of `setup` the operator asked for.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainScopeArgs {
    /// Issue the certificate only; nginx is not rendered, validated or reloaded.
    #[arg(long, default_value_t = false)]
    pub cert_only: bool,
    /// Render, validate and reload nginx only; the certificate store is untouched.
    #[arg(long, default_value_t = false)]
    pub proxy_only: bool,
}

/// Whether the run acts, and whether it may prompt.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainExecutionArgs {
    /// Actually execute changes (default: dry-run, prints only).
    #[arg(long, default_value_t = false)]
    pub apply: bool,
    /// Skip optional feature prompts.
    #[arg(long, short = 'y', default_value_t = false)]
    pub yes: bool,
}

/// How hard issuance tries before giving up.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainRetryArgs {
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
}

/// How this run behaves, as opposed to what it leaves behind.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainRunArgs {
    /// Use the Let's Encrypt test CA.
    #[arg(long, default_value_t = false)]
    pub staging: bool,
    /// Reissue even if the current certificate is still valid.
    #[arg(long, default_value_t = false)]
    pub force: bool,
    /// Hold a flock so overlapping runs cannot collide.
    #[arg(long, default_value_t = false)]
    pub lock: bool,
}

/// What happens to the certificate store around the run.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainStoreArgs {
    /// Back up the certificate store before replacing it.
    #[arg(long, default_value_t = false)]
    pub backup_certs: bool,
    /// End a live run by forcing a renewal.
    #[arg(long, default_value_t = false)]
    pub auto_renew: bool,
}

/// Every flag `scripts/__domain.sh setup` accepts, as parsed from argv.
///
/// The values stay `Option`/`bool` here so clap keeps "not typed" distinct from
/// "typed as 0"; `cli::resolve` performs the single projection onto
/// [`crate::core::domain_setup::DomainSetupRequest`].
#[derive(Args, Clone, Debug)]
pub struct DomainSetupArgs {
    /// Certificate type (letsencrypt|provided|selfsigned); unset lets `DOMAIN_CERT_METHOD` apply.
    #[arg(long)]
    pub cert: Option<String>,
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
    /// ACME challenge (http-01|dns-01|tls-alpn-01); unset lets `ACME_CHALLENGE` apply.
    #[arg(long)]
    pub challenge: Option<String>,
    /// ACME certificate authority; unset lets `ACME_CA` apply.
    #[arg(long)]
    pub ca: Option<String>,
    /// Explicit ACME directory URL; unset lets `ACME_DIRECTORY_URL` apply.
    #[arg(long)]
    pub acme_server: Option<String>,
    /// ACME client (certbot|lego); unset lets `ACME_CLIENT` apply.
    #[arg(long)]
    pub acme_client: Option<String>,
    /// Address lego binds for tls-alpn-01; unset lets `ACME_TLS_ALPN_ADDRESS` apply.
    #[arg(long)]
    pub tls_address: Option<String>,
    /// Command run after a successful renewal.
    #[arg(long)]
    pub deploy_hook: Option<String>,
    #[command(flatten)]
    pub scope: DomainScopeArgs,
    #[command(flatten)]
    pub execution: DomainExecutionArgs,
    #[command(flatten)]
    pub retry: DomainRetryArgs,
    #[command(flatten)]
    pub run: DomainRunArgs,
    #[command(flatten)]
    pub store: DomainStoreArgs,
}
