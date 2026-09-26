use std::process::Command;

use super::{Commands, ConfigSub};
use crate::core::config::{config_show, ConfigError};
use crate::core::dispatch::{DispatchKey, DispatchTarget};
use crate::core::docker::{DockerClient, StepReport};
use crate::core::docker_targets::DockerError;
use crate::core::runner::{exit_code, RunError, Runner};

use super::resolve::resolve_catalog;

/// Every way a parsed command can fail, in one type so the exit path reports a
/// sentence instead of a debug-formatted string.
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error(
        "no catalog entry for dispatch key `{key}`: add it to `core::catalog` so the CLI and \
         the TUI resolve it the same way"
    )]
    MissingCatalogEntry { key: String },
    #[error(
        "`{command}` has no handler: update `cli::resolve_catalog` so every command is \
         dispatched"
    )]
    UnhandledCommand { command: String },
    #[error("these steps failed: {}", failed.join(", "))]
    StepsFailed { failed: Vec<String> },
    #[error("could not start `{program}`: {source}. Set EDITOR to an installed editor.")]
    EditorLaunch {
        program: String,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Run(#[from] RunError),
    #[error(transparent)]
    Docker(#[from] DockerError),
    #[error(transparent)]
    Config(#[from] ConfigError),
}

/// Which stack lifecycle command the user asked for.
enum StackOp {
    Stop,
    Clean,
    Pull,
}

pub fn handle(cmd: Commands) -> Result<(), CliError> {
    let runner = Runner::new()?;
    if let Some((key, args)) = resolve_catalog(&cmd) {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        return run_target(&runner, key, &refs);
    }
    match cmd {
        Commands::Deploy { target, img } => handle_deploy(&target, img),
        Commands::Stop { stack } => handle_stack(StackOp::Stop, &stack),
        Commands::Clean { stack } => handle_stack(StackOp::Clean, &stack),
        Commands::Pull { stack } => handle_stack(StackOp::Pull, &stack),
        Commands::Config { sub } => handle_config(sub, &runner),
        // WHY: a new command that neither resolver claims is a dispatch gap, not
        // a crash — report it so the fix is a catalog entry, not a backtrace.
        other => Err(CliError::UnhandledCommand {
            command: format!("{other:?}"),
        }),
    }
}

fn run_target(runner: &Runner, key: DispatchKey, args: &[&str]) -> Result<(), CliError> {
    match crate::core::dispatch::target(key) {
        Some(DispatchTarget::Script(name)) => {
            let code = runner.run_sh(name, args)?;
            report_exit(code, format!("bash scripts/{name}"))
        }
        Some(DispatchTarget::Make(target)) => Ok(runner.run_make_checked(target, &[])?),
        None => Err(CliError::MissingCatalogEntry {
            key: format!("{key:?}"),
        }),
    }
}

/// Fails the command when a subprocess reported a non-zero exit, naming what
/// ran so the message identifies the step that failed.
fn report_exit(code: i32, command: String) -> Result<(), CliError> {
    if code == 0 {
        return Ok(());
    }
    Err(CliError::Run(RunError::NonZero { command, code }))
}

fn handle_stack(op: StackOp, stack: &str) -> Result<(), CliError> {
    let client = DockerClient::new()?;
    let report = match op {
        StackOp::Stop => client.stop(stack)?,
        StackOp::Clean => client.clean(stack)?,
        StackOp::Pull => client.pull(stack)?,
    };
    report_steps(&report)
}

fn handle_deploy(target: &str, img: bool) -> Result<(), CliError> {
    let client = DockerClient::new()?;
    let report = client.deploy(target, img)?;
    report_steps(&report)
}

/// Prints one line per make target and fails the command if any of them failed,
/// naming them so the report says which step needs attention.
fn report_steps(report: &StepReport) -> Result<(), CliError> {
    for (step, code) in &report.steps {
        println!("{step}: {}", if *code == 0 { "OK" } else { "FAILED" });
    }
    let failed: Vec<String> = report
        .steps
        .iter()
        .filter(|(_, code)| *code != 0)
        .map(|(step, _)| step.clone())
        .collect();
    if failed.is_empty() {
        return Ok(());
    }
    Err(CliError::StepsFailed { failed })
}

fn handle_config(sub: ConfigSub, runner: &Runner) -> Result<(), CliError> {
    match sub {
        ConfigSub::Sync => Err(CliError::UnhandledCommand {
            command: "config sync".to_string(),
        }),
        ConfigSub::Edit => run_config_edit(),
        ConfigSub::Show => {
            let output = config_show(&runner.repo_root().join("config.toml"))?;
            println!("{output}");
            Ok(())
        }
    }
}

fn run_config_edit() -> Result<(), CliError> {
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "nano".to_string());
    let runner = Runner::new()?;
    let config_path = runner.repo_root().join("config.toml");
    let status = Command::new(&editor)
        .arg(&config_path)
        .status()
        .map_err(|source| CliError::EditorLaunch {
            program: editor.clone(),
            source,
        })?;
    let code = exit_code(status);
    report_exit(code, format!("editor {editor}"))
}
