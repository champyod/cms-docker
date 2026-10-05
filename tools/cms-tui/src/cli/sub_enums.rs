//! The leaf subcommand enums — the groups whose variants are names and nothing else.
//!
//! WHY these sit apart from the top-level tree: every one of them is the payload of a single
//! variant of [`Commands`](super::Commands), and none carries a flag of its own. Reading them
//! next to the variant that holds them makes the tree itself unreadable, and the tree is the
//! part that has to be read as a whole.

use clap::ValueEnum;

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
