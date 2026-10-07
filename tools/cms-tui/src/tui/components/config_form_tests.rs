//! `ConfigForm` behaviour: focus navigation, editing, and reading typed values.
//!
//! WHY the assertions are phrased against `value_of`/`is_on`/`number_of` rather than the
//! raw `fields` vec: those are the three reads the domain page actually performs, so a
//! regression in one of them fails here instead of surfacing as a wrong argv on apply.

use super::{ConfigForm, KeyOutcome};
use crate::tui::components::form_field::{Field, FieldKind};
use crossterm::event::KeyCode;

fn label(value: &str) -> String {
    value.to_string()
}

fn form_two() -> ConfigForm {
    ConfigForm::from_text_fields(vec![
        (label("KEY_A"), "val_a".to_string()),
        (label("KEY_B"), "val_b".to_string()),
    ])
}

fn mixed() -> ConfigForm {
    ConfigForm::new(vec![
        Field::new(label("TEXT"), "value".to_string(), FieldKind::Text),
        Field::new(label("NUM"), "15".to_string(), FieldKind::Integer),
        Field::new(
            label("ON"),
            String::new(),
            FieldKind::Toggle { is_on: true },
        ),
        Field::new(
            label("OFF"),
            String::new(),
            FieldKind::Toggle { is_on: false },
        ),
    ])
}

#[test]
fn from_text_fields_builds_with_labels_and_values() {
    let form = form_two();
    assert_eq!(form.len(), 2);
    assert_eq!(form.value_of("KEY_A"), "val_a");
    assert_eq!(form.value_of("KEY_B"), "val_b");
    assert_eq!(form.active(), 0);
    assert!(form.fields()[0].is_focused());
    assert!(!form.fields()[1].is_focused());
}

#[test]
fn an_unknown_label_reads_as_empty_rather_than_panicking() {
    let form = form_two();
    assert_eq!(form.value_of("NOPE"), "");
    assert!(!form.is_on("NOPE"));
    assert_eq!(form.number_of("NOPE"), None);
    assert_eq!(form.index_of("NOPE"), None);
}

#[test]
fn handle_key_down_moves_focus() {
    let mut form = form_two();
    assert!(form.handle_key(KeyCode::Down).is_edited());
    assert_eq!(form.active(), 1);
    assert!(!form.fields()[0].is_focused());
    assert!(form.fields()[1].is_focused());
}

#[test]
fn enter_moves_focus_so_the_page_can_keep_submit() {
    let mut form = form_two();
    assert!(form.handle_key(KeyCode::Enter).is_edited());
    assert_eq!(form.active(), 1);
}

#[test]
fn enter_on_a_toggle_flips_it_without_leaving_the_field() {
    let mut form = mixed();
    while form.active() != 2 {
        form.handle_key(KeyCode::Down);
    }
    assert!(form.is_on("ON"));
    form.handle_key(KeyCode::Enter);
    assert!(!form.is_on("ON"));
    assert_eq!(form.active(), 2, "focus stays on the toggle");
}

#[test]
fn space_also_flips_a_toggle() {
    let mut form = mixed();
    while form.active() != 3 {
        form.handle_key(KeyCode::Down);
    }
    form.handle_key(KeyCode::Char(' '));
    assert!(form.is_on("OFF"));
}

#[test]
fn home_returns_to_the_first_field() {
    let mut form = form_two();
    form.handle_key(KeyCode::Down);
    form.handle_key(KeyCode::Home);
    assert_eq!(form.active(), 0);
}

#[test]
fn tab_and_backtab_walk_focus_in_both_directions() {
    let mut form = mixed();
    form.handle_key(KeyCode::Tab);
    assert_eq!(form.active(), 1);
    form.handle_key(KeyCode::BackTab);
    assert_eq!(form.active(), 0);
}

#[test]
fn arrow_up_clamps_at_zero() {
    let mut form = form_two();
    form.handle_key(KeyCode::Up);
    assert_eq!(form.active(), 0);
    form.handle_key(KeyCode::Down);
    assert_eq!(form.active(), 1);
    form.handle_key(KeyCode::Up);
    assert_eq!(form.active(), 0);
    form.handle_key(KeyCode::Up);
    assert_eq!(form.active(), 0);
}

#[test]
fn arrow_down_clamps_at_last() {
    let mut form = form_two();
    for _ in 0..5 {
        form.handle_key(KeyCode::Down);
    }
    assert_eq!(form.active(), 1);
}

#[test]
fn typing_reaches_the_field_under_the_cursor() {
    let mut form = form_two();
    form.handle_key(KeyCode::Char('!'));
    assert_eq!(form.value_of("KEY_A"), "val_a!");
    form.handle_key(KeyCode::Down);
    form.handle_key(KeyCode::Char('?'));
    assert_eq!(form.value_of("KEY_B"), "val_b?");
    assert_eq!(form.value_of("KEY_A"), "val_a!");
}

#[test]
fn an_integer_field_refuses_a_letter_and_says_so() {
    let mut form = mixed();
    while form.active() != 1 {
        form.handle_key(KeyCode::Down);
    }
    form.handle_key(KeyCode::Char('9'));
    assert_eq!(form.value_of("NUM"), "159");
    assert_eq!(
        form.handle_key(KeyCode::Char('x')),
        KeyOutcome::Refused("digits only")
    );
    assert_eq!(
        form.value_of("NUM"),
        "159",
        "the refused letter is not inserted"
    );
    assert_eq!(form.notice_of("NUM"), Some("digits only"));
}

#[test]
fn a_number_is_read_back_when_it_parses_and_blank_when_it_does_not() {
    let mut form = mixed();
    assert_eq!(form.number_of("NUM"), Some(15));
    while form.active() != 1 {
        form.handle_key(KeyCode::Down);
    }
    for _ in 0..4 {
        form.handle_key(KeyCode::Backspace);
    }
    assert_eq!(form.number_of("NUM"), None, "blank means unset, not zero");
}

#[test]
fn a_blanked_integer_field_reports_no_number_at_all() {
    let mut form = ConfigForm::new(vec![Field::new(
        label("NUM"),
        "7".to_string(),
        FieldKind::Integer,
    )]);
    form.handle_key(KeyCode::Backspace);
    assert_eq!(form.number_of("NUM"), None);
}

#[test]
fn a_multibyte_edit_does_not_panic_or_corrupt_the_value() {
    let mut form = ConfigForm::new(vec![Field::new(
        label("TEXT"),
        "héllo".to_string(),
        FieldKind::Text,
    )]);
    form.handle_key(KeyCode::Backspace);
    assert_eq!(form.value_of("TEXT"), "héll");
    form.handle_key(KeyCode::Char('o'));
    assert_eq!(form.value_of("TEXT"), "héllo");
}

#[test]
fn an_empty_form_swallows_keys_without_panicking() {
    let mut form = ConfigForm::new(Vec::new());
    assert!(form.is_empty());
    assert_eq!(form.handle_key(KeyCode::Enter), KeyOutcome::Ignored);
    assert_eq!(form.handle_key(KeyCode::Down), KeyOutcome::Ignored);
    assert_eq!(form.handle_key(KeyCode::Char('x')), KeyOutcome::Ignored);
    assert_eq!(form.len(), 0);
}
