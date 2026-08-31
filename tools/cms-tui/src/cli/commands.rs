use std::process::Command;

use super::{
    BackupSub, Commands, ConfigSub, ContestSub, DbSub, DomainSub, FunnelSub, SecretsSub,
    TailscaleSub, WorkerSub,
};
use crate::core::config::config_show;
use crate::core::dispatch::{self, DispatchKey, DispatchTarget};
use crate::core::docker::DockerClient;
use crate::core::runner::Runner;

/// Returns the subprocess exit code for a script, treating a failed spawn as 1.
///
/// `script` must be a target resolved from the dispatch table; the table's
/// single source of truth guarantees the name stays consistent across the
/// bash shim and this binary.
fn run_script(runner: &Runner, script: &str, args: &[&str]) -> i32 {
    runner.run_sh(script, args).unwrap_or_else(|err| {
        eprintln!("cms error: script {script} failed to spawn: {err}");
        1
    })
}

/// Resolves and runs the target declared for `key` with the given runtime args.
///
/// Returns the subprocess exit code, treating a failed spawn as 1.
fn run_target(runner: &Runner, key: DispatchKey, args: &[&str]) -> i32 {
    match dispatch::target(key) {
        Some(DispatchTarget::Script(name)) => run_script(runner, name, args),
        Some(DispatchTarget::Make(target)) => runner.run_make(target, &[]).unwrap_or_else(|err| {
            eprintln!("cms error: make {target} failed to spawn: {err}");
            1
        }),
        None => {
            eprintln!("cms error: no dispatch target for {key:?}");
            1
        }
    }
}

/// Returns `Err` when `code` is non-zero, so failed commands surface in `main`
/// exactly like the bash dispatcher's `exit "$rc"` paths.
fn propagate_exit(code: i32) -> Result<(), Box<dyn std::error::Error>> {
    if code != 0 {
        Err(format!("command exited with status {code}").into())
    } else {
        Ok(())
    }
}

/// Dispatches all 24 commands to their real core execution.
///
/// # Errors
///
/// Returns `Err` when a command exits non-zero or a client fails to initialize.
///
/// The CLI dispatcher resolves each command's script/make target from the
/// single dispatch table; only the runtime arguments (stacks, archives, verbs,
/// flags) are derived here from the parsed subcommand.
#[allow(clippy::too_many_lines)]
pub fn handle(cmd: Commands) -> Result<(), Box<dyn std::error::Error>> {
    let runner = Runner::new()?;
    match cmd {
        Commands::Setup => propagate_exit(run_target(&runner, DispatchKey::Setup, &["--fresh"])),
        Commands::Update { all } => {
            let key = if all {
                DispatchKey::UpdateAll
            } else {
                DispatchKey::Update
            };
            propagate_exit(run_target(&runner, key, &[]))
        }
        Commands::Fix => propagate_exit(run_target(&runner, DispatchKey::Fix, &["--fix"])),
        Commands::Deploy { target, img } => {
            let client = DockerClient::new()?;
            let report = client.deploy(&target, img)?;
            for (step, code) in &report.steps {
                println!("{step}: {}", if *code == 0 { "OK" } else { "FAILED" });
            }
            propagate_exit(i32::from(!report.is_success()))
        }
        Commands::Stop { stack } => run_docker_exit(&DockerClient::new()?, |c| c.stop(&stack)),
        Commands::Clean { stack } => run_docker_exit(&DockerClient::new()?, |c| c.clean(&stack)),
        Commands::Pull { stack } => run_docker_exit(&DockerClient::new()?, |c| c.pull(&stack)),
        Commands::Db { sub } => {
            let key = match sub {
                DbSub::Init => DispatchKey::DbInit,
                DbSub::Reset => DispatchKey::DbReset,
                DbSub::Clean => DispatchKey::DbClean,
                DbSub::Sync => DispatchKey::DbSync,
            };
            propagate_exit(run_target(&runner, key, &[]))
        }
        Commands::AdminCreate => propagate_exit(run_target(&runner, DispatchKey::AdminCreate, &[])),
        Commands::Status => propagate_exit(run_target(&runner, DispatchKey::Status, &[])),
        Commands::Monitor => propagate_exit(run_target(&runner, DispatchKey::Monitor, &[])),
        Commands::Backup { sub } => {
            let key = match sub {
                Some(BackupSub::Drill) => DispatchKey::BackupDrill,
                Some(BackupSub::Offsite) => DispatchKey::BackupOffsite,
                None => DispatchKey::Backup,
            };
            propagate_exit(run_target(&runner, key, &[]))
        }
        Commands::Restore { archive } => {
            propagate_exit(run_target(&runner, DispatchKey::Restore, &[&archive]))
        }
        Commands::Secrets { sub } => {
            let (key, flag) = match sub {
                SecretsSub::Rotate => (DispatchKey::SecretsRotate, "--apply"),
                SecretsSub::Audit => (DispatchKey::SecretsAudit, "--audit"),
                SecretsSub::Generate => (DispatchKey::SecretsGenerate, "--generate"),
            };
            propagate_exit(run_target(&runner, key, &[flag]))
        }
        Commands::Doctor => propagate_exit(run_target(&runner, DispatchKey::Doctor, &[])),
        Commands::Test => propagate_exit(run_target(&runner, DispatchKey::Test, &[])),
        Commands::Worker { sub } => {
            let (key, args) = match sub {
                WorkerSub::Edit => (DispatchKey::WorkerEdit, Vec::new()),
                WorkerSub::Deploy => (DispatchKey::WorkerDeploy, vec!["deploy".to_string()]),
                WorkerSub::Stop => (
                    DispatchKey::WorkerStop,
                    vec!["stop".to_string(), "all".to_string()],
                ),
                WorkerSub::List => (DispatchKey::WorkerList, vec!["list".to_string()]),
                WorkerSub::Server => (DispatchKey::WorkerServer, Vec::new()),
                WorkerSub::Connect => (DispatchKey::WorkerConnect, Vec::new()),
                WorkerSub::Cgroup => (DispatchKey::WorkerCgroup, Vec::new()),
            };
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            propagate_exit(run_target(&runner, key, &args))
        }
        Commands::Tailscale { sub } => {
            let (key, arg) = match sub {
                TailscaleSub::Setup => (DispatchKey::TailscaleSetup, "setup"),
                TailscaleSub::Status => (DispatchKey::TailscaleStatus, "status"),
                TailscaleSub::Remove => (DispatchKey::TailscaleRemove, "remove"),
            };
            propagate_exit(run_target(&runner, key, &[arg]))
        }
        Commands::Expose => propagate_exit(run_target(&runner, DispatchKey::Expose, &[])),
        Commands::Funnel { sub } => {
            let (key, arg) = match sub {
                FunnelSub::Setup => (DispatchKey::FunnelSetup, "setup"),
                FunnelSub::Passwd => (DispatchKey::FunnelPasswd, "passwd"),
                FunnelSub::Remove => (DispatchKey::FunnelRemove, "remove"),
                FunnelSub::Status => (DispatchKey::FunnelStatus, "status"),
            };
            propagate_exit(run_target(&runner, key, &[arg]))
        }
        Commands::Contest { sub } => match sub {
            ContestSub::Create => {
                propagate_exit(run_target(&runner, DispatchKey::ContestCreate, &[]))
            }
        },
        Commands::UpdateServer => {
            propagate_exit(run_target(&runner, DispatchKey::UpdateServer, &[]))
        }
        Commands::Domain { sub } => {
            let (key, arg) = match sub {
                DomainSub::Setup => (DispatchKey::DomainSetup, "setup"),
                DomainSub::Status => (DispatchKey::DomainStatus, "status"),
                DomainSub::Renew => (DispatchKey::DomainRenew, "renew"),
                DomainSub::Preflight => (DispatchKey::DomainPreflight, "preflight"),
            };
            propagate_exit(run_target(&runner, key, &[arg]))
        }
        Commands::Config { sub } => match sub {
            ConfigSub::Sync => propagate_exit(run_target(&runner, DispatchKey::ConfigSync, &[])),
            ConfigSub::Edit => propagate_exit(run_config_edit()),
            ConfigSub::Show => {
                let output = config_show(&runner.repo_root().join("config.toml"))?;
                println!("{output}");
                Ok(())
            }
        },
    }
}

/// Runs a `DockerClient` operation and propagates non-zero step results.
fn run_docker_exit<F>(client: &DockerClient, op: F) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce(
        &DockerClient,
    ) -> Result<crate::core::docker::StepReport, crate::core::docker::DockerError>,
{
    let report = op(client)?;
    for (step, code) in &report.steps {
        println!("{step}: {}", if *code == 0 { "OK" } else { "FAILED" });
    }
    propagate_exit(i32::from(!report.is_success()))
}

/// Opens `config.toml` in `$EDITOR` (default `nano`), matching `cms config edit`.
fn run_config_edit() -> i32 {
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "nano".to_string());
    match Runner::new() {
        Ok(runner) => {
            let config_path = runner.repo_root().join("config.toml");
            Command::new(editor).arg(config_path).status().map_or_else(
                |err| {
                    eprintln!("cms error: editor failed to launch: {err}");
                    1
                },
                |status| status.code().unwrap_or(1),
            )
        }
        Err(err) => {
            eprintln!("cms error: repo root not found: {err}");
            2
        }
    }
}
