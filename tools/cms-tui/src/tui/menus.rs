use crate::core::dispatch::{DispatchKey, DispatchTarget};
use crate::tui::components::action_menu::ActionMenu;

fn cmd(key: DispatchKey, args: &[&str]) -> String {
    let target = crate::core::dispatch::target(key).expect("catalog must contain key");
    match target {
        DispatchTarget::Script(name) => {
            if args.is_empty() {
                format!("bash scripts/{name}")
            } else {
                format!("bash scripts/{name} {}", args.join(" "))
            }
        }
        DispatchTarget::Make(make_target) => {
            if args.is_empty() {
                format!("make {make_target}")
            } else {
                format!("make {make_target} {}", args.join(" "))
            }
        }
    }
}

fn catalog_entry(
    label: &str,
    key: DispatchKey,
    args: &[&str],
) -> (String, String, bool, bool, bool) {
    let spec = crate::core::catalog::spec_for(key).expect("catalog must contain key");
    (
        label.to_string(),
        cmd(key, args),
        spec.requires_tty,
        spec.requires_sudo,
        spec.capture_output,
    )
}

fn capitalize(input: &str) -> String {
    let mut chars = input.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let mut out = String::new();
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
            out
        }
    }
}

fn stacks_deploy(items: &mut Vec<(String, String, bool, bool, bool)>) {
    let stacks = crate::core::docker::ALL_STACKS;
    for stack in stacks {
        items.push((
            format!("Deploy {}", capitalize(stack)),
            format!("make {stack}"),
            true,
            false,
            false,
        ));
    }
    items.push((
        "Deploy All".to_string(),
        "make core infra admin contest worker".to_string(),
        true,
        false,
        false,
    ));
    for stack in stacks {
        items.push((
            format!("Deploy {} (--img)", capitalize(stack)),
            format!("DEPLOYMENT_TYPE_OVERRIDE=img make {stack}"),
            true,
            false,
            false,
        ));
    }
    items.push((
        "Deploy All (--img)".to_string(),
        "DEPLOYMENT_TYPE_OVERRIDE=img make core infra admin contest worker".to_string(),
        true,
        false,
        false,
    ));
}

fn stacks_controls(items: &mut Vec<(String, String, bool, bool, bool)>) {
    let stacks = crate::core::docker::ALL_STACKS;
    for stack in stacks {
        items.push((
            format!("Stop {}", capitalize(stack)),
            format!("make {stack}-stop"),
            true,
            false,
            false,
        ));
    }
    items.push((
        "Stop All".to_string(),
        "make core-stop admin-stop contest-stop worker-stop infra-stop".to_string(),
        true,
        false,
        false,
    ));
    for stack in stacks {
        items.push((
            format!("Clean {}", capitalize(stack)),
            format!("make {stack}-clean"),
            true,
            false,
            false,
        ));
    }
    items.push((
        "Clean All".to_string(),
        "make core-clean admin-clean contest-clean worker-clean infra-clean".to_string(),
        true,
        false,
        false,
    ));
    for stack in stacks {
        items.push((
            format!("Pull {}", capitalize(stack)),
            format!("make pull-{stack}"),
            true,
            false,
            false,
        ));
    }
    items.push((
        "Pull All".to_string(),
        "make pull".to_string(),
        true,
        false,
        false,
    ));
}

pub fn stacks_menu() -> ActionMenu {
    let mut items: Vec<(String, String, bool, bool, bool)> = Vec::new();
    stacks_deploy(&mut items);
    stacks_controls(&mut items);
    ActionMenu::with_meta(items)
}

pub fn database_menu() -> ActionMenu {
    ActionMenu::with_meta(vec![
        catalog_entry("Initialize Database", DispatchKey::DbInit, &[]),
        catalog_entry("Reset Database", DispatchKey::DbReset, &[]),
        catalog_entry("Clean Database", DispatchKey::DbClean, &[]),
        catalog_entry("Sync Schema (Prisma)", DispatchKey::DbSync, &[]),
    ])
}

pub fn worker_menu() -> ActionMenu {
    ActionMenu::with_meta(vec![
        catalog_entry("Worker Edit", DispatchKey::WorkerEdit, &[]),
        catalog_entry(
            "Worker Deploy (all)",
            DispatchKey::WorkerDeploy,
            &["deploy", "all"],
        ),
        catalog_entry(
            "Worker Stop (all)",
            DispatchKey::WorkerStop,
            &["stop", "all"],
        ),
        catalog_entry("Worker List", DispatchKey::WorkerList, &["list"]),
        catalog_entry("Worker Attach", DispatchKey::WorkerAttach, &["attach"]),
        catalog_entry("Setup Cgroups", DispatchKey::WorkerCgroup, &[]),
    ])
}

pub fn ingress_menu() -> ActionMenu {
    ActionMenu::with_meta(vec![
        catalog_entry("Tailscale Setup", DispatchKey::TailscaleSetup, &["setup"]),
        catalog_entry(
            "Tailscale Status",
            DispatchKey::TailscaleStatus,
            &["status"],
        ),
        catalog_entry(
            "Tailscale Remove",
            DispatchKey::TailscaleRemove,
            &["remove"],
        ),
        catalog_entry("Funnel Setup", DispatchKey::FunnelSetup, &["setup"]),
        catalog_entry("Funnel Passwd", DispatchKey::FunnelPasswd, &["passwd"]),
        catalog_entry("Funnel Remove", DispatchKey::FunnelRemove, &["remove"]),
        catalog_entry("Funnel Status", DispatchKey::FunnelStatus, &["status"]),
        catalog_entry(
            "Domain Setup (letsencrypt)",
            DispatchKey::DomainSetup,
            &["setup", "--cert", "letsencrypt"],
        ),
        catalog_entry("Domain Status", DispatchKey::DomainStatus, &["status"]),
        catalog_entry("Domain Renew", DispatchKey::DomainRenew, &["renew"]),
        catalog_entry(
            "Domain Preflight",
            DispatchKey::DomainPreflight,
            &["preflight"],
        ),
    ])
}

pub fn config_menu() -> ActionMenu {
    let mut items = vec![
        catalog_entry(
            "Sync Config (.env from config.toml)",
            DispatchKey::ConfigSync,
            &[],
        ),
        catalog_entry("Secrets: Audit", DispatchKey::SecretsAudit, &["--audit"]),
        catalog_entry(
            "Secrets: Generate",
            DispatchKey::SecretsGenerate,
            &["--generate"],
        ),
        catalog_entry(
            "Secrets: Rotate (guarded)",
            DispatchKey::SecretsRotate,
            &["--apply"],
        ),
    ];
    items.push((
        "Edit config.toml".to_string(),
        "nano config.toml".to_string(),
        true,
        false,
        false,
    ));
    items.push((
        "Show config.toml".to_string(),
        "cat config.toml".to_string(),
        false,
        false,
        true,
    ));
    ActionMenu::with_meta(items)
}

pub fn backup_menu() -> ActionMenu {
    ActionMenu::with_meta(vec![
        catalog_entry("Run Backup Now", DispatchKey::Backup, &[]),
        catalog_entry("Backup Drill (test restore)", DispatchKey::BackupDrill, &[]),
        catalog_entry("Offsite Sync", DispatchKey::BackupOffsite, &[]),
        catalog_entry("Restore from Archive", DispatchKey::Restore, &[]),
    ])
}

pub fn system_menu() -> ActionMenu {
    ActionMenu::with_meta(vec![
        catalog_entry("Doctor (Preflight Checks)", DispatchKey::Doctor, &[]),
        catalog_entry("Smoke Test", DispatchKey::Test, &[]),
        catalog_entry("Full Update Server", DispatchKey::UpdateServer, &[]),
        catalog_entry("Live Status", DispatchKey::Status, &[]),
        catalog_entry("Monitor UI", DispatchKey::Monitor, &[]),
        catalog_entry("Create Contest", DispatchKey::ContestCreate, &[]),
    ])
}

pub fn bootstrap_menu() -> ActionMenu {
    ActionMenu::with_meta(vec![
        catalog_entry("Setup (Fresh Install)", DispatchKey::Setup, &["--fresh"]),
        catalog_entry("Update Config (Interactive)", DispatchKey::Update, &[]),
        catalog_entry("Full Server Update (--all)", DispatchKey::UpdateAll, &[]),
        catalog_entry("Fix (Non-interactive Repair)", DispatchKey::Fix, &["--fix"]),
        catalog_entry("Create Superadmin", DispatchKey::AdminCreate, &[]),
    ])
}
