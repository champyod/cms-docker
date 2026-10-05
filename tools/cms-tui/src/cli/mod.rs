use clap::Subcommand;

pub mod commands;
mod domain_args;
mod resolve;
mod sub_enums;

pub use domain_args::DomainSetupFlags;
pub use sub_enums::{
    BackupSub, ConfigSub, ContestSub, DbSub, FunnelSub, SecretsSub, TailscaleSub, WorkerSub,
};

/// Domain subcommands (`domain <setup|cert|proxy|status|renew|preflight|check-expiry|revoke>`).
///
/// Every verb is one depth under `./cms domain` and carries the flags its own
/// script function reads, so a flag typed after a verb reaches
/// `scripts/__domain.sh` instead of being rejected by clap.
#[derive(Subcommand, Clone, Debug)]
pub enum DomainCmd {
    /// Configure domains, TLS certificates, and render nginx config.
    // WHY the flag sets are boxed: clap flattens them into the variant, so
    // unboxed they made every other subcommand variant carry ~400 bytes.
    Setup {
        #[command(flatten)]
        flags: Box<DomainSetupFlags>,
    },
    /// Issue the certificate only; nginx config is neither rendered nor reloaded.
    Cert {
        #[command(flatten)]
        flags: Box<DomainSetupFlags>,
    },
    /// Render, validate and reload nginx only; the certificate store is untouched.
    Proxy {
        #[command(flatten)]
        flags: Box<DomainSetupFlags>,
    },
    /// Show DNS resolution, cert expiry, renewal timer, connectivity.
    Status,
    /// Force-renew LE certs or swap provided certificates.
    Renew,
    /// 9-check connectivity matrix.
    Preflight,
    /// Exit non-zero when the certificate is missing or expires within `--days`.
    CheckExpiry {
        /// Expiry threshold in days.
        #[arg(long)]
        days: Option<u32>,
        /// Alternate env file instead of ./.env.
        #[arg(long)]
        config: Option<String>,
    },
    /// Revoke the current certificate.
    Revoke {
        /// Revocation reason.
        #[arg(long)]
        reason: Option<String>,
        /// Primary domain (default from the env file).
        #[arg(long)]
        domain: Option<String>,
        /// Print actions without executing (the script default).
        #[arg(long, default_value_t = false)]
        dry_run: bool,
        /// Actually execute the revocation.
        #[arg(long, default_value_t = false)]
        apply: bool,
        /// Skip optional feature prompts.
        #[arg(long, short = 'y', default_value_t = false)]
        yes: bool,
        /// Alternate env file instead of ./.env.
        #[arg(long)]
        config: Option<String>,
    },
}

/// Full-parity CLI, mirroring the `cms` bash dispatcher.
#[derive(Subcommand, Debug)]
pub enum Commands {
    /// First-time guided setup (fresh or update wizard).
    Setup,
    /// Interactive config update wizard; `--all` aliases `update all` (full server update).
    Update {
        /// Perform full server update (alias for `update all` / `update-server`).
        #[arg(long, default_value_t = false)]
        all: bool,
    },
    /// Non-interactive repair of missing/insecure config.
    Fix,
    /// Deploy a stack (`core|admin|contest|worker|infra|all`) with optional `--img`.
    Deploy {
        /// Target stack to deploy.
        target: String,
        /// Use pre-built images (`--img`).
        #[arg(long, default_value_t = false)]
        img: bool,
    },
    /// Stop one stack or all (`stop [stack]`).
    Stop {
        /// Stack to stop (default: all).
        #[arg(default_value = "all")]
        stack: String,
    },
    /// Clean one stack or all (`clean [stack]`).
    Clean {
        /// Stack to clean (default: all).
        #[arg(default_value = "all")]
        stack: String,
    },
    /// Pull images for one stack or all (`pull [stack]`).
    Pull {
        /// Stack to pull (default: all).
        #[arg(default_value = "all")]
        stack: String,
    },
    /// Database lifecycle shortcuts (`db <init|reset|clean|sync>`).
    Db {
        #[arg(value_enum)]
        sub: DbSub,
    },
    /// Create superadmin account.
    AdminCreate,
    /// Live service status dashboard.
    Status,
    /// Monitoring/backup operations UI.
    Monitor,
    /// Run backup now; `drill` tests restore; `offsite` syncs remote.
    Backup {
        #[arg(value_enum)]
        sub: Option<BackupSub>,
    },
    /// Restore a backup archive (`restore <archive>`).
    Restore {
        /// Archive to restore.
        archive: String,
    },
    /// Secrets lifecycle (`secrets <rotate|audit|generate>`).
    Secrets {
        #[arg(value_enum)]
        sub: SecretsSub,
    },
    /// Preflight environment checks.
    Doctor,
    /// Smoke-test the deployment.
    Test,
    /// Worker fleet commands (`worker <edit|deploy|stop|list|attach|cgroup>`).
    Worker {
        #[arg(value_enum)]
        sub: WorkerSub,
        /// Extra args passed through to the fleet script: a shard spec like
        /// `4-7` or `4,5,6` for `deploy`/`stop`, or
        /// `<shard-spec> <host> <port-spec>` for `attach`.
        #[arg(num_args = 0..=3)]
        args: Vec<String>,
    },
    /// Tailnet HTTPS front (`tailscale <setup|status|remove>`).
    Tailscale {
        #[arg(value_enum)]
        sub: TailscaleSub,
    },
    /// Public ts.net access behind basic auth (`funnel <setup|passwd|remove|status>`).
    Funnel {
        #[arg(value_enum)]
        sub: FunnelSub,
    },
    /// Contest management (`contest create`).
    Contest {
        #[arg(value_enum)]
        sub: ContestSub,
    },
    /// Shard-aware full server update (git+img+db+verify).
    UpdateServer,
    /// Domain HTTPS lifecycle (`domain <setup|cert|proxy|status|renew|preflight|check-expiry|revoke>`).
    Domain {
        #[command(subcommand)]
        sub: DomainCmd,
    },
    /// Config lifecycle (`config <sync|edit|show>`).
    Config {
        #[arg(value_enum)]
        sub: ConfigSub,
    },
}

/// Dispatch a parsed `Commands` to the command handlers in `commands`.
///
/// Kept as the public entry called from `main.rs`.
///
/// # Errors
///
/// Returns `Err` with the reason a command could not run: an unresolvable
/// repository root, a missing script or make target, a failing subprocess, or
/// a command the catalog does not describe.
pub fn handle_command(cmd: Commands) -> Result<(), commands::CliError> {
    commands::handle(cmd)
}

/// The argv a parsed setup-scope flag set encodes, for callers outside this module.
///
/// WHY this is exposed: the TUI page builds the same argv from its own field state, and
/// the test that keeps the two frontends honest needs both halves, not just the one the
/// command line already covers.
#[must_use]
pub fn resolve_domain_setup_args(flags: &DomainSetupFlags) -> Vec<String> {
    domain_args::setup_args("setup", flags)
}
