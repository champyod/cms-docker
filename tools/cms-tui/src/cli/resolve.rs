use crate::core::dispatch::DispatchKey;
use crate::core::domain_renew::{domain_renew_args, DomainRenewRequest, DomainRenewSwitches};
use crate::core::domain_setup::{
    domain_setup_args, scope_from, DomainRetryPolicy, DomainSetupRequest, DomainStorePolicy,
    DomainSwitches,
};

use super::{
    BackupSub, Commands, ConfigSub, ContestSub, DbSub, DomainCmd, DomainRenewArgs, FunnelSub,
    SecretsSub, TailscaleSub, WorkerSub,
};

const fn db_key(sub: &DbSub) -> DispatchKey {
    match sub {
        DbSub::Init => DispatchKey::DbInit,
        DbSub::Reset => DispatchKey::DbReset,
        DbSub::Clean => DispatchKey::DbClean,
        DbSub::Sync => DispatchKey::DbSync,
    }
}
const fn backup_key(sub: Option<&BackupSub>) -> DispatchKey {
    match sub {
        Some(BackupSub::Drill) => DispatchKey::BackupDrill,
        Some(BackupSub::Offsite) => DispatchKey::BackupOffsite,
        None => DispatchKey::Backup,
    }
}
const fn secrets_dispatch(sub: &SecretsSub) -> (DispatchKey, &'static str) {
    match sub {
        SecretsSub::Rotate => (DispatchKey::SecretsRotate, "--apply"),
        SecretsSub::Audit => (DispatchKey::SecretsAudit, "--audit"),
        SecretsSub::Generate => (DispatchKey::SecretsGenerate, "--generate"),
    }
}
fn worker_dispatch(sub: &WorkerSub, args: &[String]) -> (DispatchKey, Vec<String>) {
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
const fn tailscale_dispatch(sub: &TailscaleSub) -> (DispatchKey, &'static str) {
    match sub {
        TailscaleSub::Setup => (DispatchKey::TailscaleSetup, "setup"),
        TailscaleSub::Status => (DispatchKey::TailscaleStatus, "status"),
        TailscaleSub::Remove => (DispatchKey::TailscaleRemove, "remove"),
    }
}
const fn funnel_dispatch(sub: &FunnelSub) -> (DispatchKey, &'static str) {
    match sub {
        FunnelSub::Setup => (DispatchKey::FunnelSetup, "setup"),
        FunnelSub::Passwd => (DispatchKey::FunnelPasswd, "passwd"),
        FunnelSub::Remove => (DispatchKey::FunnelRemove, "remove"),
        FunnelSub::Status => (DispatchKey::FunnelStatus, "status"),
    }
}
/// Projects clap's parsed domain flags onto the shared [`DomainSetupRequest`] struct.
///
/// WHY this projection exists at all: clap owns `Option<u32>` for the numeric flags so
/// "not typed" and "typed as 0" stay distinguishable, while the shared struct has to
/// keep that same distinction for the TUI form. One conversion, three callers — the
/// three setup-shaped verbs carry the same payload, so all three land here.
fn domain_setup_from(cmd: &DomainCmd) -> DomainSetupRequest {
    let common = match cmd {
        DomainCmd::Setup(args) => &args.common,
        DomainCmd::Cert(args) => &args.common,
        DomainCmd::Proxy(args) => &args.common,
        _ => return DomainSetupRequest::default(),
    };
    let args = common;

    DomainSetupRequest {
        cert: args.cert.clone().unwrap_or_default(),
        domain: clone_or_empty(args.domain.as_ref()),
        admin_domain: clone_or_empty(args.admin_domain.as_ref()),
        oj_domain: clone_or_empty(args.oj_domain.as_ref()),
        ranking_domain: clone_or_empty(args.ranking_domain.as_ref()),
        cert_path: clone_or_empty(args.cert_path.as_ref()),
        key_path: clone_or_empty(args.key_path.as_ref()),
        email: clone_or_empty(args.email.as_ref()),
        scope: scope_from(args.scope.cert_only, args.scope.proxy_only),
        is_apply: args.execution.apply,
        is_yes: args.execution.yes,
        retry: DomainRetryPolicy {
            is_auto_retry: args.retry.auto_retry,
            is_retry_forever: args.retry.retry_forever,
            attempts: args.retry.retry_attempts,
            interval: args.retry.retry_interval,
        },
        wait_port80: args.wait_port80,
        extra_domains: clone_or_empty(args.extra_domains.as_ref()),
        dns: clone_or_empty(args.dns.as_ref()),
        dns_credentials: clone_or_empty(args.dns_credentials.as_ref()),
        challenge: clone_or_empty(args.challenge.as_ref()),
        ca: clone_or_empty(args.ca.as_ref()),
        acme_server: clone_or_empty(args.acme_server.as_ref()),
        acme_client: clone_or_empty(args.acme_client.as_ref()),
        tls_address: clone_or_empty(args.tls_address.as_ref()),
        switches: DomainSwitches {
            is_staging: args.run.staging,
            is_force: args.run.force,
            is_lock: args.run.lock,
        },
        store: DomainStorePolicy {
            is_backup_certs: args.store.backup_certs,
            is_auto_renew: args.store.auto_renew,
        },
        deploy_hook: clone_or_empty(args.deploy_hook.as_ref()),
    }
}

/// Projects clap's parsed `renew` flags onto the shared [`DomainRenewRequest`] struct.
///
/// WHY a projection of its own rather than a narrowed [`DomainSetupRequest`]: `renew` has
/// no scope to project, and filling a setup request here would mean carrying
/// `--cert-only`/`--proxy-only` — the two flags `cmd_renew` must never be able to emit.
///
/// WHY the payload rather than the whole [`DomainCmd`]: the only caller already matched
/// the `Renew` arm, so re-deriving that here would add an unreachable fallback that
/// silently encodes a bare `renew` instead of failing.
fn domain_renew_from(args: &DomainRenewArgs) -> DomainRenewRequest {
    DomainRenewRequest {
        cert: clone_or_empty(args.acme.cert.as_ref()),
        domain: clone_or_empty(args.names.domain.as_ref()),
        admin_domain: clone_or_empty(args.names.admin_domain.as_ref()),
        oj_domain: clone_or_empty(args.names.oj_domain.as_ref()),
        ranking_domain: clone_or_empty(args.names.ranking_domain.as_ref()),
        email: clone_or_empty(args.acme.email.as_ref()),
        wait_port80: args.acme.wait_port80,
        extra_domains: clone_or_empty(args.acme.extra_domains.as_ref()),
        dns: clone_or_empty(args.acme.dns.as_ref()),
        dns_credentials: clone_or_empty(args.acme.dns_credentials.as_ref()),
        challenge: clone_or_empty(args.acme.challenge.as_ref()),
        ca: clone_or_empty(args.acme.ca.as_ref()),
        acme_server: clone_or_empty(args.acme.acme_server.as_ref()),
        acme_client: clone_or_empty(args.acme.acme_client.as_ref()),
        tls_address: clone_or_empty(args.acme.tls_address.as_ref()),
        switches: DomainRenewSwitches {
            is_staging: args.run.staging,
            is_lock: args.run.lock,
        },
        retry: DomainRetryPolicy {
            is_auto_retry: args.retry.auto_retry,
            is_retry_forever: args.retry.retry_forever,
            attempts: args.retry.retry_attempts,
            interval: args.retry.retry_interval,
        },
        deploy_hook: clone_or_empty(args.acme.deploy_hook.as_ref()),
        is_due: args.due,
        is_apply: args.execution.apply,
        is_backup_certs: args.store.backup_certs,
    }
}

fn clone_or_empty(value: Option<&String>) -> String {
    value.cloned().unwrap_or_default()
}

/// Whether this run asked for the cert-renewal timer to be installed.
///
/// WHY these three verbs and not `proxy`: `proxy` renders nginx and leaves the
/// certificate store alone, so its payload does not carry the flag at all — clap rejects
/// it there rather than accepting one this function would drop.
fn install_timer_requested(sub: &DomainCmd) -> bool {
    match sub {
        DomainCmd::Setup(args) | DomainCmd::Cert(args) => args.timer.install_timer,
        DomainCmd::Renew(args) => args.timer.install_timer,
        _ => false,
    }
}

/// WHY `--install-timer` is intercepted here instead of forwarded: `__domain.sh` has no
/// such option and dies with `unknown option: --install-timer` on one, so emitting it in
/// the argv would turn a working install into a failure. It also short-circuits the verb
/// rather than running alongside it — the flag installs, enables, and exits — because
/// `renew` is dry-run by default, and writing systemd units inside a dry run would
/// contradict what the operator asked for.
fn domain_dispatch(sub: &DomainCmd) -> (DispatchKey, Vec<String>) {
    if install_timer_requested(sub) {
        return (DispatchKey::DomainCertTimerInstall, Vec::new());
    }
    match sub {
        DomainCmd::Setup(_) => (
            DispatchKey::DomainSetup,
            domain_setup_args("setup", &domain_setup_from(sub)),
        ),
        DomainCmd::Cert(_) => (
            DispatchKey::DomainCert,
            domain_setup_args("cert", &domain_setup_from(sub)),
        ),
        DomainCmd::Proxy(_) => (
            DispatchKey::DomainProxy,
            domain_setup_args("proxy", &domain_setup_from(sub)),
        ),
        DomainCmd::Status { json } => {
            let mut status_args = vec!["status".to_string()];
            if *json {
                status_args.push("--json".to_string());
            }
            (DispatchKey::DomainStatus, status_args)
        }
        DomainCmd::Renew(args) => (
            DispatchKey::DomainRenew,
            domain_renew_args(&domain_renew_from(args)),
        ),
        DomainCmd::Preflight => (DispatchKey::DomainPreflight, vec!["preflight".into()]),
        DomainCmd::CheckExpiry { days } => {
            let mut args = vec!["check-expiry".into()];
            if let Some(days) = days {
                args.push("--days".into());
                args.push(days.to_string());
            }
            (DispatchKey::DomainCheckExpiry, args)
        }
        DomainCmd::Revoke { reason } => (
            DispatchKey::DomainRevoke,
            vec!["revoke".into(), "--reason".into(), reason.clone()],
        ),
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
        Commands::Db { sub } => Some((db_key(sub), Vec::new())),
        Commands::AdminCreate => Some((DispatchKey::AdminCreate, Vec::new())),
        Commands::Status => Some((DispatchKey::Status, Vec::new())),
        Commands::Monitor => Some((DispatchKey::Monitor, Vec::new())),
        Commands::Backup { sub } => Some((backup_key(sub.as_ref()), Vec::new())),
        Commands::Restore { archive } => Some((DispatchKey::Restore, vec![archive.clone()])),
        Commands::Secrets { sub } => {
            let (key, flag) = secrets_dispatch(sub);
            Some((key, vec![flag.to_string()]))
        }
        Commands::Doctor => Some((DispatchKey::Doctor, Vec::new())),
        Commands::Test => Some((DispatchKey::Test, Vec::new())),
        _ => None,
    }
}

fn resolve_fleet(cmd: &Commands) -> Option<(DispatchKey, Vec<String>)> {
    match cmd {
        Commands::Worker { sub, args } => Some(worker_dispatch(sub, args)),
        Commands::Tailscale { sub } => {
            let (key, verb) = tailscale_dispatch(sub);
            Some((key, vec![verb.to_string()]))
        }
        Commands::Funnel { sub } => {
            let (key, verb) = funnel_dispatch(sub);
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
mod argv_probe {
    use super::resolve_catalog;

    #[test]
    fn probe_cli_argv() {
        for extra in [
            vec![],
            vec!["--cert-only"],
            vec!["--proxy-only"],
            vec!["--staging"],
            vec!["--force"],
            vec!["--backup-certs"],
            vec!["--lock"],
            vec!["--auto-renew"],
            vec![
                "--staging",
                "--force",
                "--backup-certs",
                "--lock",
                "--auto-renew",
            ],
            vec![
                "--cert-only",
                "--staging",
                "--force",
                "--backup-certs",
                "--lock",
                "--auto-renew",
            ],
            vec![
                "--proxy-only",
                "--staging",
                "--force",
                "--backup-certs",
                "--lock",
                "--auto-renew",
            ],
            vec!["--retry-forever", "--apply", "-y"],
            vec!["--cert-only", "--proxy-only"],
        ] {
            let mut argv = vec!["cms", "domain", "setup"];
            argv.extend(extra.iter().copied());
            let parsed = <crate::Args as clap::Parser>::try_parse_from(argv).expect("parse");
            let out = resolve_catalog(&parsed.command.expect("has command"));
            let rendered = out.map_or_else(
                || "<none>".to_string(),
                |(k, a)| format!("{k:?} {}", a.join(" ")),
            );
            println!("PROBECLI|{}|{rendered}", extra.join(" "));
        }
    }
}

#[cfg(test)]
#[path = "resolve_tests.rs"]
mod tests;
