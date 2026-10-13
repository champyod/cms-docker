use clap::{Subcommand, ValueEnum};

pub mod commands;
mod renew_args;
mod resolve;
pub mod setup_args;

pub use renew_args::DomainRenewArgs;
pub use setup_args::{DomainProxyArgs, DomainSetupArgs};

/// Database lifecycle subcommands.
#[derive(Subcommand, Clone, Debug)]
pub enum DbCmd {
    /// Initialise the CMS database.
    Init,
    /// Reset the database (destructive).
    Reset,
    /// Delete every cms volume (destructive).
    Clean,
    /// Apply Prisma migrations and seed permissions.
    Sync,
    /// Apply the full history to the active database and verify.
    Migrate,
    /// Create a database in the cms-database container.
    Create {
        /// Database name to create.
        name: String,
        /// Print the SQL and change nothing.
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
    /// Rename a database in the cms-database container.
    Rename {
        /// Current database name.
        old: String,
        /// New database name.
        new_name: String,
        /// Print the SQL and change nothing.
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
    /// Switch the active database profile.
    Use {
        /// Profile to activate.
        name: String,
    },
}

/// Backup subcommands (`backup [drill|offsite]`; None = default backup).
#[derive(ValueEnum, Clone, Debug)]
pub enum BackupSub {
    Drill,
    Offsite,
}

/// Secrets subcommands (`secrets <rotate|audit|generate>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum SecretsSub {
    Rotate,
    Audit,
    Generate,
}

/// Worker fleet subcommands (`worker <edit|deploy|stop|list|attach|cgroup>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum WorkerSub {
    Edit,
    Deploy,
    Stop,
    List,
    Attach,
    Cgroup,
}

/// Tailscale subcommands (`tailscale <setup|status|remove>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum TailscaleSub {
    Setup,
    Status,
    Remove,
}

/// Funnel subcommands (`funnel <setup|passwd|remove|status>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum FunnelSub {
    Setup,
    Passwd,
    Remove,
    Status,
}

/// Domain subcommands (`domain <setup|cert|proxy|status|renew|preflight|check-expiry|revoke>`).
///
/// `Setup`, `Cert`, `Proxy` and `Renew` all carry the flag set
/// `scripts/__domain.sh` accepts for them, so flags typed after `./cms domain <verb>`
/// reach the script instead of being rejected by clap. Their payloads are boxed because
/// 23 flags make `setup` ~320 bytes and `renew` nearly as wide, which would otherwise
/// inflate this enum and the outer `Commands` enum that holds it. `status`, `preflight`,
/// `check-expiry` and `revoke` take a handful of flags each and stay inline.
#[derive(Subcommand, Clone, Debug)]
pub enum DomainCmd {
    /// Configure domains, TLS certificates, and render nginx config.
    Setup(Box<DomainSetupArgs>),
    /// Issue the certificate only; nginx config is neither rendered nor reloaded.
    Cert(Box<DomainSetupArgs>),
    /// Render, validate and reload nginx only; the certificate store is untouched.
    Proxy(Box<DomainProxyArgs>),
    /// Show DNS resolution, cert expiry, renewal timer, connectivity.
    Status {
        /// Emit the status report as JSON instead of the human-readable table.
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Force-renew LE certs or swap provided certificates.
    Renew(Box<DomainRenewArgs>),
    /// 9-check connectivity matrix.
    Preflight,
    /// Report certificates expiring within the threshold.
    CheckExpiry {
        /// Days ahead of expiry to treat as expiring.
        #[arg(long)]
        days: Option<u32>,
    },
    /// Revoke the issued certificate.
    Revoke {
        /// Reason recorded with the revocation.
        #[arg(long, default_value = "unspecified")]
        reason: String,
    },
}

/// Config subcommands (`config <sync|edit|show>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum ConfigSub {
    Sync,
    Edit,
    Show,
}

/// Contest subcommands (`contest <create|set-active>`).
#[derive(Subcommand, Clone, Debug)]
pub enum ContestSub {
    /// Create contests from a YAML file.
    Create,
    /// Set the active contest in the database, the single source of truth.
    SetActive {
        /// Contest id to activate.
        id: u32,
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
    /// Deploy a stack (`core|admin|contest|worker|infra|monitor|domain|waf|all`) with optional `--img`.
    ///
    /// `monitor` is the profile's own name and resolves to the same `infra` targets.
    ///
    /// `domain` and `waf` are additive: they publish host ports and start
    /// certbot, so they are never part of `all`.
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
    /// Database lifecycle commands (`db <init|reset|clean|sync|migrate|create|rename|use>`).
    Db {
        #[command(subcommand)]
        sub: DbCmd,
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
    /// Contest management (`contest <create|set-active>`).
    Contest {
        #[command(subcommand)]
        sub: ContestSub,
    },
    /// Shard-aware full server update (git+img+db+verify).
    UpdateServer,
    /// Domain HTTPS lifecycle (`domain <setup|status|renew|preflight>`).
    Domain {
        #[command(subcommand)]
        sub: DomainCmd,
    },
    /// Config lifecycle (`config <sync|edit|show>`).
    ///
    /// `sync` forwards trailing flags (`--dry-run`, `--no-secrets`) to
    /// `scripts/__config_sync.sh`; `edit`/`show` take none.
    Config {
        #[arg(value_enum)]
        sub: ConfigSub,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true, num_args = 0..=2)]
        args: Vec<String>,
    },
}

/// Dispatch a parsed `Commands` to the command handlers in `commands`.
///
/// Kept as the public entry called from `main.rs`.
///
/// # Errors
///
/// Returns `Err` when the command execution fails.
pub fn handle_command(cmd: Commands) -> Result<(), Box<dyn std::error::Error>> {
    commands::handle(cmd)
}
