use clap::Parser;
use std::error::Error;
use std::process::ExitCode;

pub mod cli;
pub mod core;
pub mod tui;

/// CMS Terminal User Interface & CLI
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Run a specific CLI command (if omitted, starts the TUI)
    #[command(subcommand)]
    command: Option<cli::Commands>,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        // WHY: returning `Err` from `main` prints the `Debug` form, which for a
        // typed error exposes variant names (`StepsFailed { failed: [...] }`)
        // instead of the message the user needs.
        Err(err) => {
            eprintln!("cms error: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    match args.command {
        Some(cmd) => {
            cli::handle_command(cmd)?;
        }
        None => {
            tui::run()?;
        }
    }

    Ok(())
}
