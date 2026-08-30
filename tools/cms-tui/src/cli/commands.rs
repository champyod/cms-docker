use std::process::Command;

use super::{
    BackupSub, Commands, ConfigSub, ContestSub, DbSub, DomainSub, FunnelSub, SecretsSub,
    TailscaleSub, WorkerSub,
};
use crate::core::config::config_show;
use crate::core::docker::DockerClient;
use crate::core::runner::Runner;

/// Returns the subprocess exit code for a script, treating a failed spawn as 1.
fn run_script(script: &str, args: &[&str]) -> i32 {
    match Runner::new() {
        Ok(runner) => runner.run_sh(script, args).unwrap_or_else(|err| {
            eprintln!("cms error: script {script} failed to spawn: {err}");
            1
        }),
        Err(err) => {
            eprintln!("cms error: repo root not found: {err}");
            2
        }
    }
}

/// Returns the subprocess exit code for a make target, treating a failed spawn as 1.
fn run_make(target: &str, envs: &[(&str, &str)]) -> i32 {
    match Runner::new() {
        Ok(runner) => runner.run_make(target, envs).unwrap_or_else(|err| {
            eprintln!("cms error: make {target} failed to spawn: {err}");
            1
        }),
        Err(err) => {
            eprintln!("cms error: repo root not found: {err}");
            2
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
/// The CLI dispatcher is intentionally a flat `match` over all commands.
#[allow(clippy::too_many_lines)]
pub fn handle(cmd: Commands) -> Result<(), Box<dyn std::error::Error>> {
    match cmd {
        Commands::Setup => propagate_exit(run_script("__update_engine.sh", &["--fresh"])),
        Commands::Update { all } => {
            if all {
                propagate_exit(run_script("__update-server.sh", &[]))
            } else {
                propagate_exit(run_script("__update_engine.sh", &[]))
            }
        }
        Commands::Fix => propagate_exit(run_script("__update_engine.sh", &["--fix"])),
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
            let target = match sub {
                DbSub::Init => "cms-init",
                DbSub::Reset => "db-reset",
                DbSub::Clean => "db-clean",
                DbSub::Sync => "prisma-sync",
            };
            propagate_exit(run_make(target, &[]))
        }
        Commands::AdminCreate => propagate_exit(run_make("admin-create", &[])),
        Commands::Status => propagate_exit(run_script("__status.sh", &[])),
        Commands::Monitor => propagate_exit(run_script("__monitor.sh", &[])),
        Commands::Backup { sub } => match sub {
            Some(BackupSub::Drill) => propagate_exit(run_script("__backup_drill.sh", &[])),
            Some(BackupSub::Offsite) => propagate_exit(run_script("__offsite-sync.sh", &[])),
            None => propagate_exit(run_make("backup", &[])),
        },
        Commands::Restore { archive } => propagate_exit(run_script("__restore.sh", &[&archive])),
        Commands::Secrets { sub } => {
            let flag = match sub {
                SecretsSub::Rotate => "--apply",
                SecretsSub::Audit => "--audit",
                SecretsSub::Generate => "--generate",
            };
            propagate_exit(run_script("__secrets-rotate.sh", &[flag]))
        }
        Commands::Doctor => propagate_exit(run_script("__preflight.sh", &[])),
        Commands::Test => propagate_exit(run_script("__smoke-test.sh", &[])),
        Commands::Worker { sub } => match sub {
            WorkerSub::Edit => propagate_exit(run_script("__tui/runners/__fleet-actions.sh", &[])),
            WorkerSub::Deploy => propagate_exit(run_script("__worker_tui.sh", &["deploy"])),
            WorkerSub::Stop => propagate_exit(run_script("__worker_tui.sh", &["stop", "all"])),
            WorkerSub::List => propagate_exit(run_script("__worker_tui.sh", &["list"])),
            WorkerSub::Server => propagate_exit(run_script("__tui/wizards/__server.sh", &[])),
            WorkerSub::Connect => propagate_exit(run_script("__worker_connect.sh", &[])),
            WorkerSub::Cgroup => propagate_exit(run_script("__worker_cgroup_setup.sh", &[])),
        },
        Commands::Tailscale { sub } => {
            let arg = match sub {
                TailscaleSub::Setup => "setup",
                TailscaleSub::Status => "status",
                TailscaleSub::Remove => "remove",
            };
            propagate_exit(run_script("__tailscale_serve.sh", &[arg]))
        }
        Commands::Expose => propagate_exit(run_script("__tui/wizards/__expose.sh", &[])),
        Commands::Funnel { sub } => {
            let arg = match sub {
                FunnelSub::Setup => "setup",
                FunnelSub::Passwd => "passwd",
                FunnelSub::Remove => "remove",
                FunnelSub::Status => "status",
            };
            propagate_exit(run_script("__funnel.sh", &[arg]))
        }
        Commands::Contest { sub } => match sub {
            ContestSub::Create => propagate_exit(run_script("__create_contests.sh", &[])),
        },
        Commands::UpdateServer => propagate_exit(run_script("__update-server.sh", &[])),
        Commands::Domain { sub } => {
            let arg = match sub {
                DomainSub::Setup => "setup",
                DomainSub::Status => "status",
                DomainSub::Renew => "renew",
                DomainSub::Preflight => "preflight",
            };
            propagate_exit(run_script("__domain.sh", &[arg]))
        }
        Commands::Config { sub } => match sub {
            ConfigSub::Sync => propagate_exit(run_script("__config_sync.sh", &[])),
            ConfigSub::Edit => propagate_exit(run_config_edit()),
            ConfigSub::Show => {
                let runner = Runner::new()?;
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
