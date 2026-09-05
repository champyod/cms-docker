//! Single source of truth mapping every CLI command to the script or make
//! target it executes.
//!
//! The legacy `cms` bash dispatcher no longer declares these names itself — it
//! delegates to this crate for the mapped commands — so each target literal
//! lives in exactly one place. `cli::commands` and `core::docker` read this
//! table instead of hardcoding script/make names.
//!
//! This module only declares names. `core::runner` is what actually spawns
//! `sh`/`make` directly in the repo root; nothing here or in a caller invokes
//! `./cms` itself, so delegation can never recurse.

/// A concrete command invocation. Payload-free so it can serve as a stable,
/// comparable table key (unlike `cli::Commands`, which carries per-invocation
/// data such as stack targets and subcommands).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DispatchKey {
    /// `./cms setup`
    Setup,
    /// `./cms update` (config-only wizard)
    Update,
    /// `./cms update --all`
    UpdateAll,
    /// `./cms fix`
    Fix,
    /// `./cms db init`
    DbInit,
    /// `./cms db reset`
    DbReset,
    /// `./cms db clean`
    DbClean,
    /// `./cms db sync`
    DbSync,
    /// `./cms admin-create`
    AdminCreate,
    /// `./cms status`
    Status,
    /// `./cms monitor`
    Monitor,
    /// `./cms backup`
    Backup,
    /// `./cms backup drill`
    BackupDrill,
    /// `./cms backup offsite`
    BackupOffsite,
    /// `./cms restore <archive>`
    Restore,
    /// `./cms secrets rotate`
    SecretsRotate,
    /// `./cms secrets audit`
    SecretsAudit,
    /// `./cms secrets generate`
    SecretsGenerate,
    /// `./cms doctor`
    Doctor,
    /// `./cms test`
    Test,
    /// `./cms worker edit`
    WorkerEdit,
    /// `./cms worker deploy`
    WorkerDeploy,
    /// `./cms worker stop`
    WorkerStop,
    /// `./cms worker list`
    WorkerList,
    /// `./cms worker attach` (interactive remote-box onboarding)
    WorkerAttach,
    /// `./cms worker cgroup`
    WorkerCgroup,
    /// `./cms tailscale setup`
    TailscaleSetup,
    /// `./cms tailscale status`
    TailscaleStatus,
    /// `./cms tailscale remove`
    TailscaleRemove,
    /// `./cms expose`
    Expose,
    /// `./cms funnel setup`
    FunnelSetup,
    /// `./cms funnel passwd`
    FunnelPasswd,
    /// `./cms funnel remove`
    FunnelRemove,
    /// `./cms funnel status`
    FunnelStatus,
    /// `./cms contest create`
    ContestCreate,
    /// `./cms update-server`
    UpdateServer,
    /// `./cms domain setup`
    DomainSetup,
    /// `./cms domain status`
    DomainStatus,
    /// `./cms domain renew`
    DomainRenew,
    /// `./cms domain preflight`
    DomainPreflight,
    /// `./cms config sync`
    ConfigSync,
}

/// What a command ultimately runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DispatchTarget {
    /// A script under `scripts/`; the caller supplies any remaining runtime
    /// arguments (backup archive, secret flag, tailscale/funnel/domain verb).
    Script(&'static str),
    /// A `Makefile` target.
    Make(&'static str),
}

/// A row in the dispatch table binding a command to its target.
pub struct DispatchEntry {
    pub key: DispatchKey,
    pub target: DispatchTarget,
}

impl DispatchEntry {
    const fn script(key: DispatchKey, name: &'static str) -> Self {
        Self {
            key,
            target: DispatchTarget::Script(name),
        }
    }

    const fn make(key: DispatchKey, target: &'static str) -> Self {
        Self {
            key,
            target: DispatchTarget::Make(target),
        }
    }
}

/// The authoritative command → target mapping. Every CLI command (and the
/// fixed subcommand arities) is declared here and nowhere else.
const TABLE: &[DispatchEntry] = &[
    DispatchEntry::script(DispatchKey::Setup, "__update_engine.sh"),
    DispatchEntry::script(DispatchKey::Update, "__update_engine.sh"),
    DispatchEntry::script(DispatchKey::UpdateAll, "__update-server.sh"),
    DispatchEntry::script(DispatchKey::Fix, "__update_engine.sh"),
    DispatchEntry::make(DispatchKey::DbInit, "cms-init"),
    DispatchEntry::make(DispatchKey::DbReset, "db-reset"),
    DispatchEntry::make(DispatchKey::DbClean, "db-clean"),
    DispatchEntry::make(DispatchKey::DbSync, "prisma-sync"),
    DispatchEntry::make(DispatchKey::AdminCreate, "admin-create"),
    DispatchEntry::script(DispatchKey::Status, "__status.sh"),
    DispatchEntry::script(DispatchKey::Monitor, "__monitor.sh"),
    DispatchEntry::make(DispatchKey::Backup, "backup"),
    DispatchEntry::script(DispatchKey::BackupDrill, "__backup_drill.sh"),
    DispatchEntry::script(DispatchKey::BackupOffsite, "__offsite-sync.sh"),
    DispatchEntry::script(DispatchKey::Restore, "__restore.sh"),
    DispatchEntry::script(DispatchKey::SecretsRotate, "__secrets-rotate.sh"),
    DispatchEntry::script(DispatchKey::SecretsAudit, "__secrets-rotate.sh"),
    DispatchEntry::script(DispatchKey::SecretsGenerate, "__secrets-rotate.sh"),
    DispatchEntry::script(DispatchKey::Doctor, "__preflight.sh"),
    DispatchEntry::script(DispatchKey::Test, "__smoke-test.sh"),
    DispatchEntry::script(DispatchKey::WorkerEdit, "__worker_tui.sh"),
    DispatchEntry::script(DispatchKey::WorkerDeploy, "__worker_tui.sh"),
    DispatchEntry::script(DispatchKey::WorkerStop, "__worker_tui.sh"),
    DispatchEntry::script(DispatchKey::WorkerList, "__worker_tui.sh"),
    DispatchEntry::script(DispatchKey::WorkerAttach, "__worker_tui.sh"),
    DispatchEntry::script(DispatchKey::WorkerCgroup, "__worker_cgroup_setup.sh"),
    DispatchEntry::script(DispatchKey::TailscaleSetup, "__tailscale_serve.sh"),
    DispatchEntry::script(DispatchKey::TailscaleStatus, "__tailscale_serve.sh"),
    DispatchEntry::script(DispatchKey::TailscaleRemove, "__tailscale_serve.sh"),
    DispatchEntry::script(DispatchKey::Expose, "__domain.sh"),
    DispatchEntry::script(DispatchKey::FunnelSetup, "__funnel.sh"),
    DispatchEntry::script(DispatchKey::FunnelPasswd, "__funnel.sh"),
    DispatchEntry::script(DispatchKey::FunnelRemove, "__funnel.sh"),
    DispatchEntry::script(DispatchKey::FunnelStatus, "__funnel.sh"),
    DispatchEntry::script(DispatchKey::ContestCreate, "__create_contests.sh"),
    DispatchEntry::script(DispatchKey::UpdateServer, "__update-server.sh"),
    DispatchEntry::script(DispatchKey::DomainSetup, "__domain.sh"),
    DispatchEntry::script(DispatchKey::DomainStatus, "__domain.sh"),
    DispatchEntry::script(DispatchKey::DomainRenew, "__domain.sh"),
    DispatchEntry::script(DispatchKey::DomainPreflight, "__domain.sh"),
    DispatchEntry::script(DispatchKey::ConfigSync, "__config_sync.sh"),
];

/// Returns the declared target for `key`.
#[must_use]
pub fn target(key: DispatchKey) -> Option<&'static DispatchTarget> {
    TABLE
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| &entry.target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_resolves_to_a_target() {
        for key in [
            DispatchKey::Setup,
            DispatchKey::Update,
            DispatchKey::UpdateAll,
            DispatchKey::Fix,
            DispatchKey::DbInit,
            DispatchKey::DbReset,
            DispatchKey::DbClean,
            DispatchKey::DbSync,
            DispatchKey::AdminCreate,
            DispatchKey::Status,
            DispatchKey::Monitor,
            DispatchKey::Backup,
            DispatchKey::BackupDrill,
            DispatchKey::BackupOffsite,
            DispatchKey::Restore,
            DispatchKey::SecretsRotate,
            DispatchKey::SecretsAudit,
            DispatchKey::SecretsGenerate,
            DispatchKey::Doctor,
            DispatchKey::Test,
            DispatchKey::WorkerEdit,
            DispatchKey::WorkerDeploy,
            DispatchKey::WorkerStop,
            DispatchKey::WorkerList,
            DispatchKey::WorkerAttach,
            DispatchKey::WorkerCgroup,
            DispatchKey::TailscaleSetup,
            DispatchKey::TailscaleStatus,
            DispatchKey::TailscaleRemove,
            DispatchKey::Expose,
            DispatchKey::FunnelSetup,
            DispatchKey::FunnelPasswd,
            DispatchKey::FunnelRemove,
            DispatchKey::FunnelStatus,
            DispatchKey::ContestCreate,
            DispatchKey::UpdateServer,
            DispatchKey::DomainSetup,
            DispatchKey::DomainStatus,
            DispatchKey::DomainRenew,
            DispatchKey::DomainPreflight,
            DispatchKey::ConfigSync,
        ] {
            assert!(target(key).is_some(), "no dispatch target for {key:?}");
        }
    }

    #[test]
    fn restore_target_is_restore_script() {
        assert_eq!(
            target(DispatchKey::Restore),
            Some(&DispatchTarget::Script("__restore.sh"))
        );
    }

    #[test]
    fn db_init_target_is_make_cms_init() {
        assert_eq!(
            target(DispatchKey::DbInit),
            Some(&DispatchTarget::Make("cms-init"))
        );
    }
}
