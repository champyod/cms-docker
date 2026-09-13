//! Declarative command catalog — single source for key, target and argument
//! metadata. Every CLI command declares its dispatch key, script/make target
//! and argument specs here so the CLI and TUI can render from one table.

use super::dispatch::{DispatchKey, DispatchTarget};

pub(crate) const SCRIPT_UPDATE_ENGINE: &str = "__update_engine.sh";
pub(crate) const SCRIPT_UPDATE_SERVER: &str = "__update-server.sh";
pub(crate) const SCRIPT_STATUS: &str = "__status.sh";
pub(crate) const SCRIPT_MONITOR: &str = "__monitor.sh";
pub(crate) const SCRIPT_BACKUP_DRILL: &str = "__backup_drill.sh";
pub(crate) const SCRIPT_OFFSITE_SYNC: &str = "__offsite-sync.sh";
pub(crate) const SCRIPT_RESTORE: &str = "__restore.sh";
pub(crate) const SCRIPT_SECRETS_ROTATE: &str = "__secrets-rotate.sh";
pub(crate) const SCRIPT_PREFLIGHT: &str = "__preflight.sh";
pub(crate) const SCRIPT_SMOKE_TEST: &str = "__smoke-test.sh";
pub(crate) const SCRIPT_WORKER_TUI: &str = "__worker_tui.sh";
pub(crate) const SCRIPT_WORKER_CGROUP: &str = "__worker_cgroup_setup.sh";
pub(crate) const SCRIPT_TAILSCALE_SERVE: &str = "__tailscale_serve.sh";
pub(crate) const SCRIPT_DOMAIN: &str = "__domain.sh";
pub(crate) const SCRIPT_FUNNEL: &str = "__funnel.sh";
pub(crate) const SCRIPT_CREATE_CONTESTS: &str = "__create_contests.sh";
pub(crate) const SCRIPT_CONFIG_SYNC: &str = "__config_sync.sh";

pub(crate) const MAKE_CMS_INIT: &str = "cms-init";
pub(crate) const MAKE_DB_RESET: &str = "db-reset";
pub(crate) const MAKE_DB_CLEAN: &str = "db-clean";
pub(crate) const MAKE_PRISMA_SYNC: &str = "prisma-sync";
pub(crate) const MAKE_ADMIN_CREATE: &str = "admin-create";
pub(crate) const MAKE_BACKUP: &str = "backup";

/// Describes a single accepted argument for documentation and TUI rendering.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ArgSpec {
    pub name: &'static str,
    pub required: bool,
    pub description: &'static str,
}

/// Declarative row binding a command key to its execution target and args.
pub struct CommandSpec {
    pub key: DispatchKey,
    pub target: DispatchTarget,
    pub args: &'static [ArgSpec],
    pub about: &'static str,
    pub requires_tty: bool,
    pub requires_sudo: bool,
    pub capture_output: bool,
}

pub(crate) const ARGS_NONE: &[ArgSpec] = &[];
pub(crate) const ARGS_ARCHIVE: &[ArgSpec] = &[ArgSpec {
    name: "archive",
    required: true,
    description: "Archive to restore",
}];
pub(crate) const ARGS_SECRET_FLAG: &[ArgSpec] = &[ArgSpec {
    name: "flag",
    required: true,
    description: "Secrets subcommand flag",
}];
pub(crate) const ARGS_WORKER: &[ArgSpec] = &[ArgSpec {
    name: "args",
    required: false,
    description: "Shard spec or attach args (0..3 values)",
}];
pub(crate) const ARGS_TAILSCALE: &[ArgSpec] = &[ArgSpec {
    name: "verb",
    required: true,
    description: "Tailscale verb (setup|status|remove)",
}];
pub(crate) const ARGS_FUNNEL: &[ArgSpec] = &[ArgSpec {
    name: "verb",
    required: true,
    description: "Funnel verb (setup|passwd|remove|status)",
}];
pub(crate) const ARGS_DOMAIN_SETUP: &[ArgSpec] = &[
    ArgSpec {
        name: "cert",
        required: true,
        description: "Certificate type",
    },
    ArgSpec {
        name: "domain",
        required: false,
        description: "Primary domain",
    },
    ArgSpec {
        name: "admin-domain",
        required: false,
        description: "Admin subdomain",
    },
    ArgSpec {
        name: "oj-domain",
        required: false,
        description: "OJ subdomain",
    },
    ArgSpec {
        name: "ranking-domain",
        required: false,
        description: "Ranking subdomain",
    },
    ArgSpec {
        name: "cert-path",
        required: false,
        description: "Path to fullchain.pem",
    },
    ArgSpec {
        name: "key-path",
        required: false,
        description: "Path to privkey.pem",
    },
    ArgSpec {
        name: "email",
        required: false,
        description: "Email for LE registration",
    },
    ArgSpec {
        name: "apply",
        required: false,
        description: "Actually execute changes",
    },
    ArgSpec {
        name: "yes",
        required: false,
        description: "Skip prompts",
    },
];
pub(crate) const ARGS_DOMAIN_VERB: &[ArgSpec] = &[ArgSpec {
    name: "verb",
    required: true,
    description: "Domain verb (status|renew|preflight)",
}];

mod table;
mod table_fleet;

pub use table::CORE_CATALOG;
pub use table_fleet::FLEET_CATALOG;

/// Unified catalog covering every declared command.
pub fn catalog() -> impl Iterator<Item = &'static CommandSpec> {
    CORE_CATALOG.iter().chain(FLEET_CATALOG.iter())
}

/// Returns spec for `key`, if declared.
#[must_use]
pub fn spec_for(key: DispatchKey) -> Option<&'static CommandSpec> {
    catalog().find(|entry| entry.key == key)
}
