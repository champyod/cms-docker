use crate::core::dispatch::DispatchKey;

use super::{
    domain_args::setup_args, BackupSub, Commands, ConfigSub, ContestSub, DbSub, DomainCmd,
    DomainSetupFlags, FunnelSub, SecretsSub, TailscaleSub, WorkerSub,
};

fn db_key(sub: DbSub) -> DispatchKey {
    match sub {
        DbSub::Init => DispatchKey::DbInit,
        DbSub::Reset => DispatchKey::DbReset,
        DbSub::Clean => DispatchKey::DbClean,
        DbSub::Sync => DispatchKey::DbSync,
    }
}
fn backup_key(sub: Option<BackupSub>) -> DispatchKey {
    match sub {
        Some(BackupSub::Drill) => DispatchKey::BackupDrill,
        Some(BackupSub::Offsite) => DispatchKey::BackupOffsite,
        None => DispatchKey::Backup,
    }
}
fn secrets_dispatch(sub: SecretsSub) -> (DispatchKey, &'static str) {
    match sub {
        SecretsSub::Rotate => (DispatchKey::SecretsRotate, "--apply"),
        SecretsSub::Audit => (DispatchKey::SecretsAudit, "--audit"),
        SecretsSub::Generate => (DispatchKey::SecretsGenerate, "--generate"),
    }
}
fn worker_dispatch(sub: WorkerSub, args: &[String]) -> (DispatchKey, Vec<String>) {
    let (key, mut out) = match sub {
        WorkerSub::Edit => (DispatchKey::WorkerEdit, Vec::new()),
        WorkerSub::Deploy => (DispatchKey::WorkerDeploy, vec!["deploy".into()]),
        WorkerSub::Stop => (DispatchKey::WorkerStop, vec!["stop".into()]),
        WorkerSub::List => (DispatchKey::WorkerList, vec!["list".into()]),
        WorkerSub::Attach => (DispatchKey::WorkerAttach, vec!["attach".into()]),
        WorkerSub::Cgroup => (DispatchKey::WorkerCgroup, Vec::new()),
    };
    if matches!(sub, WorkerSub::Deploy | WorkerSub::Stop | WorkerSub::Attach) {
        out.extend(args.iter().cloned());
    }
    (key, out)
}
fn tailscale_dispatch(sub: TailscaleSub) -> (DispatchKey, &'static str) {
    match sub {
        TailscaleSub::Setup => (DispatchKey::TailscaleSetup, "setup"),
        TailscaleSub::Status => (DispatchKey::TailscaleStatus, "status"),
        TailscaleSub::Remove => (DispatchKey::TailscaleRemove, "remove"),
    }
}
fn funnel_dispatch(sub: FunnelSub) -> (DispatchKey, &'static str) {
    match sub {
        FunnelSub::Setup => (DispatchKey::FunnelSetup, "setup"),
        FunnelSub::Passwd => (DispatchKey::FunnelPasswd, "passwd"),
        FunnelSub::Remove => (DispatchKey::FunnelRemove, "remove"),
        FunnelSub::Status => (DispatchKey::FunnelStatus, "status"),
    }
}
/// Builds the argv for the verbs whose whole flag surface is the shared set
/// (`setup`, `cert`, `proxy`).
///
/// WHY these three share `DomainSetup`: the key only chooses the target script,
/// and the verb that narrows the run travels in the argv the script reads first.
/// Giving each verb its own key and catalog row — so the TUI can label and
/// stream them apart — is the next step; until then the key is correct for all
/// three because all three run `__domain.sh`.
fn setup_scope_dispatch(verb: &str, flags: &DomainSetupFlags) -> (DispatchKey, Vec<String>) {
    (DispatchKey::DomainSetup, setup_args(verb, flags))
}

fn domain_dispatch(sub: &DomainCmd) -> (DispatchKey, Vec<String>) {
    match sub {
        DomainCmd::Setup { flags } => setup_scope_dispatch("setup", flags),
        DomainCmd::Cert { flags } => setup_scope_dispatch("cert", flags),
        DomainCmd::Proxy { flags } => setup_scope_dispatch("proxy", flags),
        DomainCmd::Status => (DispatchKey::DomainStatus, vec!["status".into()]),
        DomainCmd::Renew => (DispatchKey::DomainRenew, vec!["renew".into()]),
        DomainCmd::Preflight => (DispatchKey::DomainPreflight, vec!["preflight".into()]),
        DomainCmd::CheckExpiry { days, config } => {
            // WHY `DomainStatus`: both read the certificate and print a result
            // the caller consumes, so they share the streaming target until the
            // catalog gives `check-expiry` a row of its own.
            let mut args = vec!["check-expiry".to_string()];
            push_optional(&mut args, "--days", days.map(|value| value.to_string()));
            push_optional(&mut args, "--config", config.clone());
            (DispatchKey::DomainStatus, args)
        }
        DomainCmd::Revoke {
            reason,
            domain,
            dry_run,
            apply,
            yes,
            config,
        } => {
            let mut args = vec!["revoke".to_string()];
            push_optional(&mut args, "--reason", reason.clone());
            push_optional(&mut args, "--domain", domain.clone());
            if *dry_run {
                args.push("--dry-run".into());
            }
            if *apply {
                args.push("--apply".into());
            }
            if *yes {
                args.push("--yes".into());
            }
            push_optional(&mut args, "--config", config.clone());
            // WHY `DomainRenew`: revoking touches the ACME account the renewal
            // owns and needs a terminal, which is the target `DomainRenew`
            // declares; the reason is carried in the argv.
            (DispatchKey::DomainRenew, args)
        }
    }
}

/// Appends `flag value` only when a value was given, so the script keeps
/// applying the default it would have applied had the flag been omitted.
fn push_optional(out: &mut Vec<String>, flag: &str, value: Option<String>) {
    if let Some(value) = value {
        out.push(flag.to_string());
        out.push(value);
    }
}

fn resolve_basic(cmd: &Commands) -> Option<(DispatchKey, Vec<String>)> {
    match cmd {
        Commands::Setup => Some((DispatchKey::Setup, vec!["--fresh".into()])),
        Commands::Update { all } => {
            let key = if *all {
                DispatchKey::UpdateAll
            } else {
                DispatchKey::Update
            };
            Some((key, Vec::new()))
        }
        Commands::Fix => Some((DispatchKey::Fix, vec!["--fix".into()])),
        Commands::Db { sub } => Some((db_key(sub.clone()), Vec::new())),
        Commands::AdminCreate => Some((DispatchKey::AdminCreate, Vec::new())),
        Commands::Status => Some((DispatchKey::Status, Vec::new())),
        Commands::Monitor => Some((DispatchKey::Monitor, Vec::new())),
        Commands::Backup { sub } => Some((backup_key(sub.clone()), Vec::new())),
        Commands::Restore { archive } => Some((DispatchKey::Restore, vec![archive.clone()])),
        Commands::Secrets { sub } => {
            let (key, flag) = secrets_dispatch(sub.clone());
            Some((key, vec![flag.to_string()]))
        }
        Commands::Doctor => Some((DispatchKey::Doctor, Vec::new())),
        Commands::Test => Some((DispatchKey::Test, Vec::new())),
        _ => None,
    }
}

fn resolve_fleet(cmd: &Commands) -> Option<(DispatchKey, Vec<String>)> {
    match cmd {
        Commands::Worker { sub, args } => Some(worker_dispatch(sub.clone(), args)),
        Commands::Tailscale { sub } => {
            let (key, verb) = tailscale_dispatch(sub.clone());
            Some((key, vec![verb.to_string()]))
        }
        Commands::Funnel { sub } => {
            let (key, verb) = funnel_dispatch(sub.clone());
            Some((key, vec![verb.to_string()]))
        }
        Commands::Contest { sub } => match sub {
            ContestSub::Create => Some((DispatchKey::ContestCreate, Vec::new())),
        },
        Commands::UpdateServer => Some((DispatchKey::UpdateServer, Vec::new())),
        Commands::Domain { sub } => Some(domain_dispatch(sub)),
        Commands::Config { sub } => match sub {
            ConfigSub::Sync => Some((DispatchKey::ConfigSync, Vec::new())),
            ConfigSub::Edit | ConfigSub::Show => None,
        },
        _ => None,
    }
}

pub(super) fn resolve_catalog(cmd: &Commands) -> Option<(DispatchKey, Vec<String>)> {
    resolve_basic(cmd).or_else(|| resolve_fleet(cmd))
}

#[cfg(test)]
#[path = "resolve_tests.rs"]
mod tests;
