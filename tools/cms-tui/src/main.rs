use clap::Parser;
use std::error::Error;

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

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    match args.command {
        Some(cmd) => {
            // CLI Mode
            cli::handle_command(cmd)?;
        }
        None => {
            // TUI Mode
            tui::run()?;
        }
    }

    Ok(())
}
