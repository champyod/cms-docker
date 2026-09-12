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

fn stacks_deploy(items: &mut Vec<(String, String)>) {
    let stacks = crate::core::docker::ALL_STACKS;
    for stack in stacks {
        items.push((
            format!("Deploy {}", capitalize(stack)),
            format!("make {stack}"),
        ));
    }
    items.push((
        "Deploy All".to_string(),
        "make core infra admin contest worker".to_string(),
    ));
    for stack in stacks {
        items.push((
            format!("Deploy {} (--img)", capitalize(stack)),
            format!("DEPLOYMENT_TYPE_OVERRIDE=img make {stack}"),
        ));
    }
    items.push((
        "Deploy All (--img)".to_string(),
        "DEPLOYMENT_TYPE_OVERRIDE=img make core infra admin contest worker".to_string(),
    ));
}

fn stacks_controls(items: &mut Vec<(String, String)>) {
    let stacks = crate::core::docker::ALL_STACKS;
    for stack in stacks {
        items.push((
            format!("Stop {}", capitalize(stack)),
            format!("make {stack}-stop"),
        ));
    }
    items.push((
        "Stop All".to_string(),
        "make core-stop admin-stop contest-stop worker-stop infra-stop".to_string(),
    ));
    for stack in stacks {
        items.push((
            format!("Clean {}", capitalize(stack)),
            format!("make {stack}-clean"),
        ));
    }
    items.push((
        "Clean All".to_string(),
        "make core-clean admin-clean contest-clean worker-clean infra-clean".to_string(),
    ));
    for stack in stacks {
        items.push((
            format!("Pull {}", capitalize(stack)),
            format!("make pull-{stack}"),
        ));
    }
    items.push(("Pull All".to_string(), "make pull".to_string()));
}

pub fn stacks_menu() -> ActionMenu {
    let mut items: Vec<(String, String)> = Vec::new();
    stacks_deploy(&mut items);
    stacks_controls(&mut items);
    ActionMenu::new(items)
}

pub fn database_menu() -> ActionMenu {
    ActionMenu::new(vec![
        (
            "Initialize Database".to_string(),
            cmd(DispatchKey::DbInit, &[]),
        ),
        ("Reset Database".to_string(), cmd(DispatchKey::DbReset, &[])),
        ("Clean Database".to_string(), cmd(DispatchKey::DbClean, &[])),
        (
            "Sync Schema (Prisma)".to_string(),
            cmd(DispatchKey::DbSync, &[]),
        ),
    ])
}

pub fn worker_menu() -> ActionMenu {
    ActionMenu::new(vec![
        ("Worker Edit".to_string(), cmd(DispatchKey::WorkerEdit, &[])),
        (
            "Worker Deploy (all)".to_string(),
            cmd(DispatchKey::WorkerDeploy, &["deploy", "all"]),
        ),
        (
            "Worker Stop (all)".to_string(),
            cmd(DispatchKey::WorkerStop, &["stop", "all"]),
        ),
        (
            "Worker List".to_string(),
            cmd(DispatchKey::WorkerList, &["list"]),
        ),
        (
            "Worker Attach".to_string(),
            cmd(DispatchKey::WorkerAttach, &["attach"]),
        ),
        (
            "Setup Cgroups".to_string(),
            cmd(DispatchKey::WorkerCgroup, &[]),
        ),
    ])
}

pub fn ingress_menu() -> ActionMenu {
    ActionMenu::new(vec![
        (
            "Tailscale Setup".to_string(),
            cmd(DispatchKey::TailscaleSetup, &["setup"]),
        ),
        (
            "Tailscale Status".to_string(),
            cmd(DispatchKey::TailscaleStatus, &["status"]),
        ),
        (
            "Tailscale Remove".to_string(),
            cmd(DispatchKey::TailscaleRemove, &["remove"]),
        ),
        ("Expose Wizard".to_string(), cmd(DispatchKey::Expose, &[])),
        (
            "Funnel Setup".to_string(),
            cmd(DispatchKey::FunnelSetup, &["setup"]),
        ),
        (
            "Funnel Passwd".to_string(),
            cmd(DispatchKey::FunnelPasswd, &["passwd"]),
        ),
        (
            "Funnel Remove".to_string(),
            cmd(DispatchKey::FunnelRemove, &["remove"]),
        ),
        (
            "Funnel Status".to_string(),
            cmd(DispatchKey::FunnelStatus, &["status"]),
        ),
        (
            "Domain Setup (letsencrypt)".to_string(),
            cmd(
                DispatchKey::DomainSetup,
                &["setup", "--cert", "letsencrypt"],
            ),
        ),
        (
            "Domain Status".to_string(),
            cmd(DispatchKey::DomainStatus, &["status"]),
        ),
        (
            "Domain Renew".to_string(),
            cmd(DispatchKey::DomainRenew, &["renew"]),
        ),
        (
            "Domain Preflight".to_string(),
            cmd(DispatchKey::DomainPreflight, &["preflight"]),
        ),
    ])
}

pub fn config_menu() -> ActionMenu {
    ActionMenu::new(vec![
        (
            "Sync Config (.env from config.toml)".to_string(),
            cmd(DispatchKey::ConfigSync, &[]),
        ),
        (
            "Edit config.toml".to_string(),
            "nano config.toml".to_string(),
        ),
        (
            "Show config.toml".to_string(),
            "cat config.toml".to_string(),
        ),
        (
            "Secrets: Audit".to_string(),
            cmd(DispatchKey::SecretsAudit, &["--audit"]),
        ),
        (
            "Secrets: Generate".to_string(),
            cmd(DispatchKey::SecretsGenerate, &["--generate"]),
        ),
        (
            "Secrets: Rotate (guarded)".to_string(),
            cmd(DispatchKey::SecretsRotate, &["--apply"]),
        ),
    ])
}

pub fn backup_menu() -> ActionMenu {
    ActionMenu::new(vec![
        ("Run Backup Now".to_string(), cmd(DispatchKey::Backup, &[])),
        (
            "Backup Drill (test restore)".to_string(),
            cmd(DispatchKey::BackupDrill, &[]),
        ),
        (
            "Offsite Sync".to_string(),
            cmd(DispatchKey::BackupOffsite, &[]),
        ),
        (
            "Restore from Archive".to_string(),
            cmd(DispatchKey::Restore, &[]),
        ),
    ])
}

pub fn system_menu() -> ActionMenu {
    ActionMenu::new(vec![
        (
            "Doctor (Preflight Checks)".to_string(),
            cmd(DispatchKey::Doctor, &[]),
        ),
        ("Smoke Test".to_string(), cmd(DispatchKey::Test, &[])),
        (
            "Full Update Server".to_string(),
            cmd(DispatchKey::UpdateServer, &[]),
        ),
        ("Live Status".to_string(), cmd(DispatchKey::Status, &[])),
        ("Monitor UI".to_string(), cmd(DispatchKey::Monitor, &[])),
        (
            "Create Contest".to_string(),
            cmd(DispatchKey::ContestCreate, &[]),
        ),
    ])
}

pub fn bootstrap_menu() -> ActionMenu {
    ActionMenu::new(vec![
        (
            "Setup (Fresh Install)".to_string(),
            cmd(DispatchKey::Setup, &["--fresh"]),
        ),
        (
            "Update Config (Interactive)".to_string(),
            cmd(DispatchKey::Update, &[]),
        ),
        (
            "Full Server Update (--all)".to_string(),
            cmd(DispatchKey::UpdateAll, &[]),
        ),
        (
            "Fix (Non-interactive Repair)".to_string(),
            cmd(DispatchKey::Fix, &["--fix"]),
        ),
        (
            "Create Superadmin".to_string(),
            cmd(DispatchKey::AdminCreate, &[]),
        ),
    ])
}
