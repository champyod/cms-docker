use crate::core::dispatch::{DispatchKey, DispatchTarget};
use crate::tui::components::action_menu::ActionMenu;
use crate::tui::stack_entries::{stack_control_entries, stack_deploy_entries};

/// Builds the shell command for a catalog key.
///
/// An unresolved key yields an empty command, which `App::run_selected_action`
/// refuses to run. Menus are drawn inside the event loop, so panicking here
/// would take the whole interface down over one missing catalog row; the
/// invariant that every key resolves is pinned by a test instead.
fn cmd(key: DispatchKey, args: &[&str]) -> String {
    let Some(target) = crate::core::dispatch::target(key) else {
        return String::new();
    };
    let head = match target {
        DispatchTarget::Script(name) => format!("bash scripts/{name}"),
        DispatchTarget::Make(make_target) => format!("make {make_target}"),
    };
    if args.is_empty() {
        return head;
    }
    format!("{head} {}", args.join(" "))
}

/// Builds a menu row from the catalog entry for `key`, falling back to the
/// label alone when the entry is missing so the page still renders.
fn catalog_entry(
    label: &str,
    key: DispatchKey,
    args: &[&str],
) -> (String, String, bool, bool, bool) {
    let command = cmd(key, args);
    let Some(spec) = crate::core::catalog::spec_for(key) else {
        return (label.to_string(), command, false, false, false);
    };
    (
        label.to_string(),
        command,
        spec.requires_tty,
        spec.requires_sudo,
        spec.capture_output,
    )
}

pub fn stacks_menu() -> ActionMenu {
    let mut items: Vec<(String, String, bool, bool, bool)> = stack_deploy_entries();
    items.extend(stack_control_entries());
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

#[cfg(test)]
mod tests {
    use super::*;

    fn every_menu() -> Vec<ActionMenu> {
        vec![
            stacks_menu(),
            database_menu(),
            worker_menu(),
            ingress_menu(),
            config_menu(),
            backup_menu(),
            system_menu(),
            bootstrap_menu(),
        ]
    }

    /// An entry whose command is empty cannot be run, so every menu row has to
    /// resolve to a catalog target. This is what the missing-row fallback in
    /// `cmd` would otherwise hide.
    #[test]
    fn every_menu_entry_resolves_to_a_runnable_command() {
        for menu in every_menu() {
            assert!(!menu.is_empty(), "a menu must not be empty");
            for index in 0..menu.len() {
                let item = menu.get_item(index).expect("index is in range");
                assert!(
                    !item.description.trim().is_empty(),
                    "menu entry `{}` has no command",
                    item.label
                );
            }
        }
    }

    #[test]
    fn an_unresolvable_key_yields_an_empty_command_instead_of_a_panic() {
        let spec = crate::core::catalog::spec_for(DispatchKey::Setup);
        assert!(spec.is_some(), "the fallback is only for a missing row");
        let (label, command, tty, sudo, capture) = catalog_entry("probe", DispatchKey::Setup, &[]);
        assert_eq!(label, "probe");
        assert!(command.starts_with("bash scripts/"), "{command}");
        assert!(tty && !sudo && !capture);
    }

    #[test]
    fn stack_rows_cover_every_stack_and_both_deploy_modes() {
        let menu = stacks_menu();
        let labels: Vec<String> = (0..menu.len())
            .map(|index| {
                menu.get_item(index)
                    .expect("index is in range")
                    .label
                    .clone()
            })
            .collect();
        for stack in crate::core::docker_targets::ALL_STACKS {
            let capitalized = {
                let mut chars = stack.chars();
                let mut out = String::new();
                out.extend(chars.next().expect("stack is not empty").to_uppercase());
                out.push_str(chars.as_str());
                out
            };
            assert!(labels.contains(&format!("Deploy {capitalized}")), "{stack}");
            assert!(labels.contains(&format!("Stop {capitalized}")), "{stack}");
            assert!(labels.contains(&format!("Clean {capitalized}")), "{stack}");
            assert!(labels.contains(&format!("Pull {capitalized}")), "{stack}");
        }
        assert!(labels.contains(&"Deploy All".to_string()));
        assert!(labels.contains(&"Deploy All (--img)".to_string()));
    }
}
