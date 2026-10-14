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

    /// Print yes/no for whether the given command needs root, then exit.
    #[arg(long, global = true)]
    needs_sudo: bool,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();

    if args.needs_sudo {
        print_needs_sudo(args.command.as_ref());
        return Ok(());
    }

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

/// Answers the question the ./cms shim asks before it escalates. The catalog is the one
/// source for it (requires_sudo), so the shim keeps no second copy of the list.
fn print_needs_sudo(command: Option<&cli::Commands>) {
    let needs_root = command
        .and_then(cli::resolve_catalog_key)
        .and_then(core::catalog::spec_for)
        .is_some_and(|spec| spec.requires_sudo);
    println!("{}", if needs_root { "yes" } else { "no" });
}
