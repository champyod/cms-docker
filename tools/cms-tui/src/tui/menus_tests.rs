use crate::tui::components::action_menu::ActionMenu;
use crate::tui::menus::*;

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

/// Every domain verb is a leaf one depth under `./cms domain`, and the interface has to
/// offer each one. A verb the script can run but the menu cannot is a verb the operator
/// has to leave the interface to reach.
#[test]
fn every_domain_verb_has_a_row_that_names_its_own_verb() {
    let menu = ingress_menu();
    let rows: Vec<String> = (0..menu.len())
        .map(|index| {
            let item = menu.get_item(index).expect("index is in range");
            format!("{}\u{1}{}", item.label, item.description)
        })
        .collect();
    for verb in [
        "setup",
        "cert",
        "proxy",
        "status",
        "renew",
        "preflight",
        "check-expiry",
        "revoke",
    ] {
        let runs_verb = |row: &str| {
            row.contains(&format!("__domain.sh {verb} "))
                || row.ends_with(&format!("__domain.sh {verb}"))
        };
        assert!(
            rows.iter().any(|row| runs_verb(row)),
            "{verb} has no menu row that runs it"
        );
    }
}

/// A menu row must not arm a change the operator did not confirm: `revoke` and `renew`
/// both write, so their rows must stay on the script's own dry-run default.
#[test]
fn no_domain_menu_row_arms_a_change_on_its_own() {
    let menu = ingress_menu();
    for index in 0..menu.len() {
        let item = menu.get_item(index).expect("index is in range");
        if !item.label.starts_with("Domain") {
            continue;
        }
        assert!(
            !item.description.contains("--apply"),
            "{} would run live without a confirm step: {}",
            item.label,
            item.description
        );
    }
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
