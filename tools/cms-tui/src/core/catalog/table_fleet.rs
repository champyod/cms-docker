use super::{
    CommandSpec, ARGS_DOMAIN_SETUP, ARGS_DOMAIN_VERB, ARGS_FUNNEL, ARGS_NONE, ARGS_TAILSCALE,
    ARGS_WORKER, SCRIPT_CONFIG_SYNC, SCRIPT_CREATE_CONTESTS, SCRIPT_DOMAIN, SCRIPT_FUNNEL,
    SCRIPT_TAILSCALE_SERVE, SCRIPT_UPDATE_SERVER, SCRIPT_WORKER_CGROUP, SCRIPT_WORKER_TUI,
};
use crate::core::dispatch::{DispatchKey, DispatchTarget};

pub const FLEET_CATALOG: &[CommandSpec] = &[
    CommandSpec {
        key: DispatchKey::WorkerEdit,
        target: DispatchTarget::Script(SCRIPT_WORKER_TUI),
        args: ARGS_WORKER,
        about: "Worker edit",
    },
    CommandSpec {
        key: DispatchKey::WorkerDeploy,
        target: DispatchTarget::Script(SCRIPT_WORKER_TUI),
        args: ARGS_WORKER,
        about: "Worker deploy",
    },
    CommandSpec {
        key: DispatchKey::WorkerStop,
        target: DispatchTarget::Script(SCRIPT_WORKER_TUI),
        args: ARGS_WORKER,
        about: "Worker stop",
    },
    CommandSpec {
        key: DispatchKey::WorkerList,
        target: DispatchTarget::Script(SCRIPT_WORKER_TUI),
        args: ARGS_WORKER,
        about: "Worker list",
    },
    CommandSpec {
        key: DispatchKey::WorkerAttach,
        target: DispatchTarget::Script(SCRIPT_WORKER_TUI),
        args: ARGS_WORKER,
        about: "Worker attach",
    },
    CommandSpec {
        key: DispatchKey::WorkerCgroup,
        target: DispatchTarget::Script(SCRIPT_WORKER_CGROUP),
        args: ARGS_NONE,
        about: "Worker cgroup",
    },
    CommandSpec {
        key: DispatchKey::TailscaleSetup,
        target: DispatchTarget::Script(SCRIPT_TAILSCALE_SERVE),
        args: ARGS_TAILSCALE,
        about: "Tailscale setup",
    },
    CommandSpec {
        key: DispatchKey::TailscaleStatus,
        target: DispatchTarget::Script(SCRIPT_TAILSCALE_SERVE),
        args: ARGS_TAILSCALE,
        about: "Tailscale status",
    },
    CommandSpec {
        key: DispatchKey::TailscaleRemove,
        target: DispatchTarget::Script(SCRIPT_TAILSCALE_SERVE),
        args: ARGS_TAILSCALE,
        about: "Tailscale remove",
    },
    CommandSpec {
        key: DispatchKey::Expose,
        target: DispatchTarget::Script(SCRIPT_DOMAIN),
        args: ARGS_NONE,
        about: "Pick access mode",
    },
    CommandSpec {
        key: DispatchKey::FunnelSetup,
        target: DispatchTarget::Script(SCRIPT_FUNNEL),
        args: ARGS_FUNNEL,
        about: "Funnel setup",
    },
    CommandSpec {
        key: DispatchKey::FunnelPasswd,
        target: DispatchTarget::Script(SCRIPT_FUNNEL),
        args: ARGS_FUNNEL,
        about: "Funnel passwd",
    },
    CommandSpec {
        key: DispatchKey::FunnelRemove,
        target: DispatchTarget::Script(SCRIPT_FUNNEL),
        args: ARGS_FUNNEL,
        about: "Funnel remove",
    },
    CommandSpec {
        key: DispatchKey::FunnelStatus,
        target: DispatchTarget::Script(SCRIPT_FUNNEL),
        args: ARGS_FUNNEL,
        about: "Funnel status",
    },
    CommandSpec {
        key: DispatchKey::ContestCreate,
        target: DispatchTarget::Script(SCRIPT_CREATE_CONTESTS),
        args: ARGS_NONE,
        about: "Contest create",
    },
    CommandSpec {
        key: DispatchKey::UpdateServer,
        target: DispatchTarget::Script(SCRIPT_UPDATE_SERVER),
        args: ARGS_NONE,
        about: "Shard-aware server update",
    },
    CommandSpec {
        key: DispatchKey::DomainSetup,
        target: DispatchTarget::Script(SCRIPT_DOMAIN),
        args: ARGS_DOMAIN_SETUP,
        about: "Domain setup",
    },
    CommandSpec {
        key: DispatchKey::DomainStatus,
        target: DispatchTarget::Script(SCRIPT_DOMAIN),
        args: ARGS_DOMAIN_VERB,
        about: "Domain status",
    },
    CommandSpec {
        key: DispatchKey::DomainRenew,
        target: DispatchTarget::Script(SCRIPT_DOMAIN),
        args: ARGS_DOMAIN_VERB,
        about: "Domain renew",
    },
    CommandSpec {
        key: DispatchKey::DomainPreflight,
        target: DispatchTarget::Script(SCRIPT_DOMAIN),
        args: ARGS_DOMAIN_VERB,
        about: "Domain preflight",
    },
    CommandSpec {
        key: DispatchKey::ConfigSync,
        target: DispatchTarget::Script(SCRIPT_CONFIG_SYNC),
        args: ARGS_NONE,
        about: "Config sync",
    },
];
