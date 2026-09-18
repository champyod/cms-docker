use crate::core::dispatch::DispatchKey;

use super::{
    BackupSub, Commands, ConfigSub, ContestSub, DbSub, DomainCmd, FunnelSub, SecretsSub,
    TailscaleSub, WorkerSub,
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
struct DomainSetupArgs<'a> {
    cert: &'a str,
    domain: &'a Option<String>,
    admin_domain: &'a Option<String>,
    oj_domain: &'a Option<String>,
    ranking_domain: &'a Option<String>,
    cert_path: &'a Option<String>,
    key_path: &'a Option<String>,
    email: &'a Option<String>,
    apply: bool,
    yes: bool,
}

fn domain_setup_args(params: DomainSetupArgs<'_>) -> Vec<String> {
    let mut out: Vec<String> = vec!["setup".into(), "--cert".into(), params.cert.to_string()];
    for (flag, value) in [
        ("--domain", params.domain),
        ("--admin-domain", params.admin_domain),
        ("--oj-domain", params.oj_domain),
        ("--ranking-domain", params.ranking_domain),
        ("--cert-path", params.cert_path),
        ("--key-path", params.key_path),
        ("--email", params.email),
    ] {
        if let Some(value) = value {
            out.push(flag.into());
            out.push(value.clone());
        }
    }
    if params.apply {
        out.push("--apply".into());
    }
    if params.yes {
        out.push("--yes".into());
    }
    out
}

fn domain_dispatch(sub: &DomainCmd) -> (DispatchKey, Vec<String>) {
    match sub {
        DomainCmd::Setup {
            cert,
            domain,
            admin_domain,
            oj_domain,
            ranking_domain,
            cert_path,
            key_path,
            email,
            apply,
            yes,
        } => {
            let args = domain_setup_args(DomainSetupArgs {
                cert,
                domain,
                admin_domain,
                oj_domain,
                ranking_domain,
                cert_path,
                key_path,
                email,
                apply: *apply,
                yes: *yes,
            });
            (DispatchKey::DomainSetup, args)
        }
        DomainCmd::Status => (DispatchKey::DomainStatus, vec!["status".into()]),
        DomainCmd::Renew => (DispatchKey::DomainRenew, vec!["renew".into()]),
        DomainCmd::Preflight => (DispatchKey::DomainPreflight, vec!["preflight".into()]),
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
        Commands::Config { sub, args } => match sub {
            ConfigSub::Sync => Some((DispatchKey::ConfigSync, args.clone())),
            ConfigSub::Edit | ConfigSub::Show => None,
        },
        _ => None,
    }
}

pub(super) fn resolve_catalog(cmd: &Commands) -> Option<(DispatchKey, Vec<String>)> {
    resolve_basic(cmd).or_else(|| resolve_fleet(cmd))
}

#[cfg(test)]
mod tests {
    use super::resolve_catalog;

    // Parses a full `cms …` argv the same way `main` does, so the assertions
    // exercise the real clap `Config` shape (trailing-var-arg forwarding).
    fn parse(argv: &[&str]) -> Option<(crate::core::dispatch::DispatchKey, Vec<String>)> {
        let args = <crate::Args as clap::Parser>::try_parse_from(argv).expect("parse ok");
        resolve_catalog(&args.command.expect("has command"))
    }

    #[test]
    fn config_sync_forwards_no_args() {
        let (key, args) = parse(&["cms", "config", "sync"]).expect("resolves");
        assert_eq!(key, crate::core::dispatch::DispatchKey::ConfigSync);
        assert!(args.is_empty());
    }

    #[test]
    fn config_sync_forwards_dry_run() {
        let (key, args) = parse(&["cms", "config", "sync", "--dry-run"]).expect("resolves");
        assert_eq!(key, crate::core::dispatch::DispatchKey::ConfigSync);
        assert_eq!(args, vec!["--dry-run".to_string()]);
    }

    #[test]
    fn config_sync_forwards_dry_run_and_no_secrets() {
        let (key, args) = parse(&["cms", "config", "sync", "--dry-run", "--no-secrets"]).expect("resolves");
        assert_eq!(key, crate::core::dispatch::DispatchKey::ConfigSync);
        assert_eq!(args, vec!["--dry-run".to_string(), "--no-secrets".to_string()]);
    }
}
