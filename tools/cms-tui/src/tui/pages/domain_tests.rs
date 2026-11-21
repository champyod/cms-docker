//! Assertions on the domain page's own behaviour, above the form it drives.
//!
//! WHY the arming step is tested here and not through `App`: the property that matters is
//! that no single keystroke can produce a live run, and that is a statement about
//! `DomainView::handle_key` alone.

use super::{DomainAction, DomainView};
use crate::tui::components::config_form::ConfigForm;
use crate::tui::components::form_field::{Field, FieldKind};
use crossterm::event::KeyCode;

/// A form with just the rows the arming tests need.
fn form_with_apply() -> ConfigForm {
    ConfigForm::new(vec![
        Field::new(
            "--domain".to_string(),
            String::new(),
            FieldKind::Text,
        ),
        Field::new(
            "--apply".to_string(),
            String::new(),
            FieldKind::Toggle { is_on: false },
        ),
    ])
}

fn view() -> DomainView {
    DomainView::new(form_with_apply())
}

/// Moves focus onto the apply row the way a keystroke would.
fn focus_apply(view: &mut DomainView) {
    view.form_mut().goto_row("--apply");
}

#[test]
fn a_new_form_describes_a_dry_run() {
    let view = view();
    assert!(!view.is_apply());
    assert_eq!(
        view.preview(),
        "setup --cert letsencrypt --yes",
        "the page must open showing the dry-run argv"
    );
}

#[test]
fn the_arm_key_only_opens_the_question() {
    let mut view = view();
    focus_apply(&mut view);
    assert_eq!(view.handle_key(KeyCode::Char('a')), DomainAction::Arming);
    assert!(view.is_arming());
    assert!(
        !view.is_apply(),
        "opening the question must not arm the live run"
    );
    assert!(!view.preview().contains("--apply"));
}

#[test]
fn only_a_yes_confirms_and_the_run_flag_appears_only_then() {
    let mut view = view();
    focus_apply(&mut view);
    view.handle_key(KeyCode::Char('a'));
    assert_eq!(view.handle_key(KeyCode::Char('y')), DomainAction::Confirmed);
    assert!(view.is_apply());
    assert!(view.preview().contains("--apply"));
}

#[test]
fn any_other_key_at_the_question_cancels_it() {
    for key in [
        KeyCode::Char('n'),
        KeyCode::Char('q'),
        KeyCode::Esc,
        KeyCode::Enter,
        KeyCode::Char('Y'),
    ] {
        let mut view = view();
        focus_apply(&mut view);
        view.handle_key(KeyCode::Char('a'));
        let action = view.handle_key(key);
        assert_eq!(action, DomainAction::Cancelled, "{key:?} should back out");
        assert!(!view.is_apply(), "{key:?} armed a live run");
    }
}

#[test]
fn a_cancel_leaves_no_trace_on_the_apply_row() {
    let mut view = view();
    focus_apply(&mut view);
    view.handle_key(KeyCode::Char('a'));
    view.handle_key(KeyCode::Char('n'));
    assert!(!view.is_arming());
    assert!(!view.form().is_on("--apply"));
}

#[test]
fn pressing_a_again_on_an_armed_form_disarms_it() {
    let mut view = view();
    focus_apply(&mut view);
    view.handle_key(KeyCode::Char('a'));
    view.handle_key(KeyCode::Char('y'));
    assert!(view.is_apply());
    assert_eq!(view.handle_key(KeyCode::Char('a')), DomainAction::Cancelled);
    assert!(!view.is_apply(), "a second 'a' disarms rather than re-asking");
}

#[test]
fn the_arm_key_is_ignored_on_any_row_but_the_apply_one() {
    let mut view = view();
    assert_eq!(
        view.handle_key(KeyCode::Char('a')),
        DomainAction::Edited,
        "on a text row 'a' is just a character"
    );
    assert!(!view.is_arming());
}

#[test]
fn submit_and_back_are_the_pages_own_keys() {
    let mut view = view();
    assert_eq!(view.handle_key(KeyCode::Char('r')), DomainAction::Submit);
    assert_eq!(view.handle_key(KeyCode::Esc), DomainAction::Back);
}

#[test]
fn a_key_the_page_does_not_own_is_left_alone() {
    let mut view = view();
    assert_eq!(view.handle_key(KeyCode::F(5)), DomainAction::Ignored);
}

#[test]
fn the_last_run_is_recorded_so_the_page_can_show_what_was_launched() {
    let mut view = view();
    assert!(view.last_run().is_empty());
    view.note_run(vec!["setup".to_string(), "--cert".to_string()]);
    assert_eq!(view.last_run(), ["setup".to_string(), "--cert".to_string()]);
}
