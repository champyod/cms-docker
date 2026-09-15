//! Stable key and target types for command dispatch.
//!
//! The legacy `cms` bash dispatcher delegates mapped commands to this crate,
//! so target resolution goes through the single catalog table. This module
//! owns the key type and delegates target lookup to `crate::core::catalog`
//! where every literal lives exactly once.

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

/// Returns the declared target for `key` via the single catalog table.
#[must_use]
pub fn target(key: DispatchKey) -> Option<&'static DispatchTarget> {
    crate::core::catalog::spec_for(key).map(|spec| &spec.target)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_KEYS: &[DispatchKey] = &[
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
    ];
    #[test]
    fn every_key_resolves_to_a_target() {
        for key in ALL_KEYS.iter().copied() {
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
