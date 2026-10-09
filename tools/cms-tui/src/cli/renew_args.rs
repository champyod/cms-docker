//! The flag payload behind `cms domain renew`.
//!
//! WHY this is a module of its own rather than a second payload inside
//! `cli::setup_args`: that file is about `setup`'s flags, and the two payloads together
//! are wider than one file should be.
//!
//! WHY three of the groups are flattened in from `setup_args` instead of being declared
//! here: retry and the run switches are the same flags on both verbs, and the script's
//! own help groups them as shared. Declaring a second copy would be free to drift.
//! The two groups below are renew-specific precisely because `setup`'s counterparts carry
//! a flag renew must never accept — `--yes` prompts for optional features that
//! `cmd_renew` does not offer, and `--auto-renew` is how a *setup* run triggers a
//! renewal, which on `renew` would ask for the thing the verb is already doing.

use clap::Args;

use super::setup_args::{DomainRetryArgs, DomainRunArgs, DomainTimerArgs};

/// Whether the run acts on the certificate or only previews it.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainRenewExecutionArgs {
    /// Actually renew; without it the script prints a dry-run line and returns.
    #[arg(long, default_value_t = false)]
    pub apply: bool,
}

/// What happens to the certificate store around the renewal.
#[derive(Args, Clone, Copy, Debug, Default)]
pub struct DomainRenewStoreArgs {
    /// Back up the certificate store before replacing it.
    #[arg(long, default_value_t = false)]
    pub backup_certs: bool,
}

/// The hosts the renewed certificate has to cover.
#[derive(Args, Clone, Debug, Default)]
pub struct DomainRenewNameArgs {
    /// Primary domain.
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
}

/// Which CA is asked, and how it is reached.
#[derive(Args, Clone, Debug, Default)]
pub struct DomainRenewAcmeArgs {
    /// Certificate type (letsencrypt|provided|selfsigned); unset lets `DOMAIN_CERT_METHOD` apply.
    #[arg(long)]
    pub cert: Option<String>,
    /// Email for Let's Encrypt registration.
    #[arg(long)]
    pub email: Option<String>,
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
    /// DNS-01 provider (e.g. cloudflare); empty keeps HTTP-01.
    #[arg(long)]
    pub dns: Option<String>,
    /// Credential file for the DNS-01 plugin.
    #[arg(long)]
    pub dns_credentials: Option<String>,
    /// Extra SAN hostnames, space separated.
    #[arg(long)]
    pub extra_domains: Option<String>,
    /// Wait for :80 to answer before requesting the certificate.
    #[arg(long)]
    pub wait_port80: Option<u32>,
    /// Command run after a successful renewal.
    #[arg(long)]
    pub deploy_hook: Option<String>,
}

/// Every flag `scripts/__domain.sh renew` accepts, as parsed from argv.
///
/// The values stay `Option`/`bool` here so clap keeps "not typed" distinct from "typed
/// as 0"; `cli::resolve` performs the single projection onto
/// [`crate::core::domain_renew::DomainRenewRequest`].
#[derive(Args, Clone, Debug)]
pub struct DomainRenewArgs {
    /// Renew only what the CA reports as due instead of forcing a reissue now — what a
    /// scheduler passes.
    #[arg(long, default_value_t = false)]
    pub due: bool,
    #[command(flatten)]
    pub execution: DomainRenewExecutionArgs,
    #[command(flatten)]
    pub store: DomainRenewStoreArgs,
    #[command(flatten)]
    pub run: DomainRunArgs,
    #[command(flatten)]
    pub retry: DomainRetryArgs,
    #[command(flatten)]
    pub names: DomainRenewNameArgs,
    #[command(flatten)]
    pub acme: DomainRenewAcmeArgs,
    #[command(flatten)]
    pub timer: DomainTimerArgs,
}
