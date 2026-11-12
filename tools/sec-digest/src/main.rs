//! `sec-digest --no-llm --print-brief`: collect, rank, render, print.
//!
//! No delivery and no model in this build. Feed failures are printed on stderr and
//! carried inside the brief, because a quiet day must not look like a broken feed.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

use sec_digest::fleet_state::{self, FleetState};
use sec_digest::record::RunRecord;
use sec_digest::{feeds, http, inventory, llm, rank, render, seen, timeutil};

#[derive(Debug, Parser)]
#[command(name = "sec-digest", about = "Daily security digest for the CMS fleet")]
struct Cli {
    /// Collect and render, print no brief and deliver nothing.
    #[arg(long)]
    dry_run: bool,
    /// Deterministic template only; never invoke the model chain.
    #[arg(long)]
    no_llm: bool,
    /// Collection window in hours.
    #[arg(long, default_value_t = 26)]
    window_hours: u32,
    /// Print the brief to stdout.
    #[arg(long)]
    print_brief: bool,
    /// Inventory root; defaults to CMS_HUB_ROOT or the hub checkout.
    #[arg(long)]
    hub: Option<PathBuf>,
}

fn hub_root(cli: &Cli) -> PathBuf {
    if let Some(explicit) = &cli.hub {
        return explicit.clone();
    }
    if let Some(from_env) = std::env::var_os("CMS_HUB_ROOT") {
        return PathBuf::from(from_env);
    }
    PathBuf::from(inventory::DEFAULT_HUB)
}

fn collect_record(cli: &Cli, now: chrono::DateTime<chrono::Utc>) -> RunRecord {
    let inventory = inventory::load(&hub_root(cli));
    let (mut collected, reports) = feeds::collect(timeutil::since(now, cli.window_hours));
    collected.window_hours = cli.window_hours;
    let prior = seen::load(&http::state_dir());
    let (sections, stats) = rank::build_digest(&collected, &inventory, &prior);

    let mut errors: Vec<String> = reports.iter().filter_map(|r| r.problem.clone()).collect();
    errors.extend(inventory.notes.iter().cloned());
    for report in &reports {
        eprintln!("[feeds] {}: {}", report.name, report.summary());
    }
    RunRecord {
        run_id: now.format("%Y%m%dT%H%M%SZ").to_string(),
        window_hours: cli.window_hours,
        inventory,
        stats,
        sections,
        collector_errors: errors,
        model: None,
    }
}

/// LLM when the chain answers, template otherwise; the winner is the footer label.
fn brief_body(cli: &Cli, record: &RunRecord) -> (String, String) {
    if record.is_empty() {
        let body = render::nothing_new(record.window_hours, &record.stats, &record.collector_errors);
        return (body, "template".to_string());
    }
    if cli.no_llm {
        return (render::template_brief(&record.brief_input()), "template".to_string());
    }
    let outcome = llm::write_brief(record, &http::state_dir());
    if outcome.text.is_empty() {
        let body = render::template_brief(&record.brief_input());
        return (body, "template".to_string());
    }
    (outcome.text, outcome.model)
}

/// Repos and hosts are read live; every probe failure is named on stderr too.
fn read_fleet(cli: &Cli, now: chrono::DateTime<chrono::Utc>) -> FleetState {
    let config = fleet_state::Config::from_env(hub_root(cli));
    let fleet = fleet_state::collect(&config, &fleet_state::SystemRunner, now);
    for error in &fleet.errors {
        eprintln!("[fleet] {error}");
    }
    fleet
}

fn run(cli: &Cli) -> Result<(), String> {
    let now = timeutil::now_utc();
    let mut record = collect_record(cli, now);
    let fleet = read_fleet(cli, now);
    let (body, model) = brief_body(cli, &record);
    record.model = Some(model.clone());
    let text = format!("{}\n\n{}", body.trim_end(), render::fleet_block_at(&fleet, now))
        .trim()
        .to_string();

    if cli.dry_run {
        eprintln!("[digest] dry run; not delivering");
        return Ok(());
    }
    if cli.print_brief {
        println!("{text}");
        eprintln!(
            "[digest] {} · {} chars · model={}",
            record.run_id,
            text.chars().count(),
            model
        );
    }
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("[digest] {error}");
            ExitCode::FAILURE
        }
    }
}
