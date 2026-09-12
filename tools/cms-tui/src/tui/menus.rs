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

pub fn stacks_menu() -> ActionMenu {
    let stacks = crate::core::docker::ALL_STACKS;
    let mut items: Vec<(String, String)> = stacks
        .iter()
        .map(|stack| {
            let label = format!("Deploy {}", capitalize(stack));
            let command = format!("make {stack}");
            (label, command)
        })
        .collect();
    let all_order = ["core", "infra", "admin", "contest", "worker"];
    let all_cmd = format!("make {}", all_order.join(" "));
    items.push(("Deploy All".to_string(), all_cmd));
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
        (
            "Fleet Manager (TUI)".to_string(),
            cmd(DispatchKey::WorkerDeploy, &["deploy", "all"]),
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
            "Tailscale Setup/Status".to_string(),
            cmd(DispatchKey::TailscaleStatus, &["status"]),
        ),
        (
            "Expose Wizard".to_string(),
            "echo 'Expose Wizard now lives in the Rust TUI — use Ingress panel'".to_string(),
        ),
        (
            "Funnel Setup/Status".to_string(),
            cmd(DispatchKey::FunnelStatus, &["status"]),
        ),
        (
            "Domain Setup/Status".to_string(),
            cmd(DispatchKey::DomainStatus, &["status"]),
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
            "Fix (Non-interactive Repair)".to_string(),
            cmd(DispatchKey::Fix, &["--fix"]),
        ),
        (
            "Create Superadmin".to_string(),
            cmd(DispatchKey::AdminCreate, &[]),
        ),
    ])
}
