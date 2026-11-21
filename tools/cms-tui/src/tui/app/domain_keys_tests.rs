//! Assertions on routing around the domain form, and on the argv it hands the script.
//!
//! WHY the argv is asserted rather than the process: `__domain.sh` is not something a
//! unit test may run, and what this layer owns is the argv it is handed. The one thing
//! asserted here about execution is that the arguments stay SEPARATE — see
//! `a_shell_metacharacter_stays_inside_one_argument`.

use super::App;
use crate::tui::app::Route;
use crate::tui::pages::domain::DomainAction;
use crossterm::event::KeyCode;

/// A per-test directory that no other test shares.
fn scratch(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("cms_domain_keys_{label}_{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

/// A fresh app whose domain form is seeded from an empty box.
fn app_on_empty(label: &str) -> App {
    let mut app = App::new();
    app.domain = crate::tui::pages::domain::DomainView::from_disk(&scratch(label));
    app
}

#[test]
fn a_shell_metacharacter_stays_inside_one_argument() {
    // WHY this exact string: `--deploy-hook` is free text, and joining the argv into a
    // `bash -c` line made `a; id` two commands. Passing argv as a vector keeps it one
    // argument, so the shell never gets to re-parse an operator's value.
    let hook = "systemctl reload nginx; id";
    let setup = crate::core::domain_setup::DomainSetupRequest {
        deploy_hook: hook.to_string(),
        ..Default::default()
    };
    let args = crate::core::domain_setup::domain_setup_args("setup", &setup);
    let position = args
        .iter()
        .position(|arg| arg == "--deploy-hook")
        .expect("hook flag is emitted");
    assert_eq!(args[position + 1], hook, "the value is one argument");
    assert_eq!(
        args.iter().filter(|arg| *arg == hook).count(),
        1,
        "the value is never split into a second argv entry"
    );
}

#[test]
fn the_domain_page_is_reachable_from_the_ingress_page() {
    let mut app = App::new();
    app.push_route(Route::Ingress);
    assert_eq!(*app.current_route(), Route::Ingress);
    app.push_route(Route::Domain);
    assert_eq!(*app.current_route(), Route::Domain);
    assert_eq!(app.stack_depth(), 3);
}

#[test]
fn leaving_the_form_returns_to_the_page_it_was_opened_from() {
    let mut app = app_on_empty("leave");
    app.push_route(Route::Ingress);
    app.push_route(Route::Domain);
    app.leave_domain();
    assert_eq!(*app.current_route(), Route::Ingress);
}

#[test]
fn a_form_opened_from_the_dashboard_leaves_back_to_the_dashboard() {
    let mut app = app_on_empty("no-ingress");
    app.push_route(Route::Domain);
    app.leave_domain();
    assert_eq!(
        *app.current_route(),
        Route::Dashboard,
        "leaving undoes the push rather than jumping somewhere new"
    );
}

#[test]
fn the_page_owns_no_action_menu() {
    let mut app = app_on_empty("menu");
    app.push_route(Route::Domain);
    assert!(app.active_menu().is_none());
}

#[test]
fn rows_and_the_page_bindings_are_handed_straight_to_the_form() {
    let mut app = app_on_empty("keys");
    app.push_route(Route::Domain);
    assert_eq!(app.handle_domain_key(KeyCode::Down), DomainAction::Edited);
    assert_eq!(
        app.handle_domain_key(KeyCode::Char('z')),
        DomainAction::Edited,
        "typing belongs to the focused row"
    );
    assert_eq!(
        app.handle_domain_key(KeyCode::Char('r')),
        DomainAction::Submit,
        "r runs the plan the form describes"
    );
    assert_eq!(app.handle_domain_key(KeyCode::Esc), DomainAction::Back);
}

#[test]
fn a_key_the_page_does_not_own_is_left_for_the_global_handler() {
    let mut app = app_on_empty("ignored");
    app.push_route(Route::Domain);
    assert_eq!(
        app.handle_domain_key(KeyCode::F(5)),
        DomainAction::Ignored,
        "the page must not swallow keys it has no meaning for"
    );
}
