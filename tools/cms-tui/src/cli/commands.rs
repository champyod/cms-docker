use std::process::Command;

use super::{Commands, ConfigSub};
use crate::core::config::config_show;
use crate::core::dispatch::{DispatchKey, DispatchTarget};
use crate::core::docker::DockerClient;
use crate::core::runner::Runner;

use super::resolve::resolve_catalog;

fn run_script(runner: &Runner, script: &str, args: &[&str]) -> i32 {
    runner.run_sh(script, args).unwrap_or_else(|err| {
        eprintln!("cms error: script {script} failed to spawn: {err}");
        1
    })
}

fn run_target(runner: &Runner, key: DispatchKey, args: &[&str]) -> i32 {
    match crate::core::dispatch::target(key) {
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

fn propagate_exit(code: i32) -> Result<(), Box<dyn std::error::Error>> {
    if code != 0 {
        Err(format!("command exited with status {code}").into())
    } else {
        Ok(())
    }
}

pub fn handle(cmd: Commands) -> Result<(), Box<dyn std::error::Error>> {
    let runner = Runner::new()?;
    if let Some((key, args)) = resolve_catalog(&cmd) {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        return propagate_exit(run_target(&runner, key, &refs));
    }
    match cmd {
        Commands::Deploy { target, img } => handle_deploy(target, img),
        Commands::Stop { stack } => run_docker_exit(&DockerClient::new()?, |c| c.stop(&stack)),
        Commands::Clean { stack } => run_docker_exit(&DockerClient::new()?, |c| c.clean(&stack)),
        Commands::Pull { stack } => run_docker_exit(&DockerClient::new()?, |c| c.pull(&stack)),
        Commands::Config { sub, .. } => handle_config(sub, &runner),
        _ => unreachable!("catalog should have handled remaining command"),
    }
}

fn handle_deploy(target: String, img: bool) -> Result<(), Box<dyn std::error::Error>> {
    let client = DockerClient::new()?;
    let report = client.deploy(&target, img)?;
    for (step, code) in &report.steps {
        println!("{step}: {}", if *code == 0 { "OK" } else { "FAILED" });
    }
    propagate_exit(i32::from(!report.is_success()))
}

fn handle_config(sub: ConfigSub, runner: &Runner) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        ConfigSub::Sync => unreachable!("sync is catalog-handled"),
        ConfigSub::Edit => propagate_exit(run_config_edit()),
        ConfigSub::Show => {
            let output = config_show(&runner.repo_root().join("config.toml"))?;
            println!("{output}");
            Ok(())
        }
    }
}

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
