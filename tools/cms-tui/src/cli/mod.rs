use clap::{Subcommand, ValueEnum};

pub mod commands;

/// Database lifecycle subcommands (`db <init|reset|clean|sync>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum DbSub {
    Init,
    Reset,
    Clean,
    Sync,
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

/// Domain subcommands (`domain <setup|status|renew|preflight>`).
///
/// `Setup` carries the full flag set accepted by `scripts/__domain.sh setup`
/// so flags typed after `./cms domain setup` reach the script instead of
/// being rejected by clap.
#[derive(Subcommand, Clone, Debug)]
pub enum DomainCmd {
    /// Configure domains, TLS certificates, and render nginx config.
    Setup {
        /// Certificate type (letsencrypt|provided|selfsigned).
        #[arg(long, default_value = "letsencrypt")]
        cert: String,
        /// Primary domain (default from `DOMAIN_NAME` env).
        #[arg(long)]
        domain: Option<String>,
        /// Admin subdomain.
        #[arg(long)]
        admin_domain: Option<String>,
        /// OJ subdomain.
        #[arg(long)]
        oj_domain: Option<String>,
        /// Ranking subdomain.
        #[arg(long)]
        ranking_domain: Option<String>,
        /// Path to fullchain.pem (required for --cert provided).
        #[arg(long)]
        cert_path: Option<String>,
        /// Path to privkey.pem (required for --cert provided).
        #[arg(long)]
        key_path: Option<String>,
        /// Email for Let's Encrypt registration (required for letsencrypt).
        #[arg(long)]
        email: Option<String>,
        /// Actually execute changes (default: dry-run, prints only).
        #[arg(long, default_value_t = false)]
        apply: bool,
        /// Skip optional feature prompts.
        #[arg(long, short = 'y', default_value_t = false)]
        yes: bool,
    },
    /// Show DNS resolution, cert expiry, renewal timer, connectivity.
    Status,
    /// Force-renew LE certs or swap provided certificates.
    Renew,
    /// 9-check connectivity matrix.
    Preflight,
}

/// Config subcommands (`config <sync|edit|show>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum ConfigSub {
    Sync,
    Edit,
    Show,
}

/// Contest subcommands (`contest <create>`).
#[derive(ValueEnum, Clone, Debug)]
pub enum ContestSub {
    Create,
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
    /// Pick local/public/tailscale access mode per UI.
    Expose,
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
    /// Domain HTTPS lifecycle (`domain <setup|status|renew|preflight>`).
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
/// Returns `Err` when the command execution fails.
pub fn handle_command(cmd: Commands) -> Result<(), Box<dyn std::error::Error>> {
    commands::handle(cmd)
}
