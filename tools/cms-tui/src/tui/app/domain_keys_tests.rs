use super::{App, DomainKeyOutcome};
use crate::tui::app::Route;
use crate::tui::pages::domain_fields::APPLY_LABEL;
use ratatui::crossterm::event::KeyCode;

fn on_domain() -> App {
    let mut app = App::new();
    app.push_route(Route::Domain);
    app
}

#[test]
fn the_submit_key_asks_the_loop_to_run_the_form() {
    let mut app = on_domain();
    assert_eq!(
        app.handle_domain_key(KeyCode::Char('r')),
        DomainKeyOutcome::Submit
    );
}

#[test]
fn escape_asks_the_loop_to_leave_the_page() {
    let mut app = on_domain();
    assert_eq!(app.handle_domain_key(KeyCode::Esc), DomainKeyOutcome::Back);
}

#[test]
fn typing_a_character_edits_a_row_instead_of_leaving_the_page() {
    let mut app = on_domain();
    app.domain.form_mut().focus_row("--domain");
    assert_eq!(
        app.handle_domain_key(KeyCode::Char('x')),
        DomainKeyOutcome::Edited
    );
    assert_eq!(app.domain.form().value_of("--domain"), "x");
}

/// A dry run must reach nothing but the toast. This is the property that makes a
/// mis-aimed keystroke on a twenty-row form harmless.
#[test]
fn a_dry_run_reports_the_plan_and_changes_nothing() {
    let mut app = on_domain();
    app.domain.form_mut().focus_row("--domain");
    app.handle_domain_key(KeyCode::Char('a'));
    assert!(!app.domain.is_apply());
    app.run_domain_form()
        .expect("the dry run reports without spawning");
    let toast = app.last_toast.expect("the run reported what it would do");
    assert!(
        toast.0.contains("dry run"),
        "a dry run reported {:?}",
        toast.0
    );
    assert!(app.domain.last_run().iter().any(|arg| arg == "setup"));
}

#[test]
fn arming_then_confirming_is_the_only_way_to_reach_a_live_run() {
    let mut app = on_domain();
    app.domain.form_mut().focus_row(APPLY_LABEL);
    assert_eq!(
        app.handle_domain_key(KeyCode::Char('a')),
        DomainKeyOutcome::Arming
    );
    assert!(!app.domain.is_apply(), "one key armed the run");
    assert_eq!(
        app.handle_domain_key(KeyCode::Char('y')),
        DomainKeyOutcome::Confirmed
    );
    assert!(app.domain.is_apply());
}

/// The recorded argv must be exactly what a run would send, so the page can show what was
/// launched rather than reconstructing it afterwards.
#[test]
fn a_run_records_the_argv_it_would_send() {
    let mut app = on_domain();
    app.domain.form_mut().focus_row("--domain");
    app.handle_domain_key(KeyCode::Char('x'));
    app.run_domain_form()
        .expect("the dry run reports without spawning");
    assert!(
        app.domain.last_run().iter().any(|arg| arg == "x"),
        "{:?} does not carry the typed value",
        app.domain.last_run()
    );
}

#[test]
fn the_domain_page_has_no_menu_of_its_own() {
    let mut app = on_domain();
    assert!(
        app.active_menu().is_none(),
        "the form owns its keys, so the shared menu keys must not apply"
    );
}
