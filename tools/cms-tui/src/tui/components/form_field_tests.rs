//! Field-level editing assertions: what each kind accepts and refuses.
//!
//! WHY these live beside the type rather than in `ConfigForm`'s tests: a refused
//! keystroke is a property of the field kind, and asserting it through the form would
//! also prove navigation, so a failure would not say which half broke.

use super::{Field, FieldKind};
use crossterm::event::KeyCode;

fn text(value: &str) -> Field {
    Field::new("KEY".to_string(), value.to_string(), FieldKind::Text)
}

fn toggle(is_on: bool) -> Field {
    Field::new(
        "KEY".to_string(),
        String::new(),
        FieldKind::Toggle { is_on },
    )
}

fn integer(value: &str) -> Field {
    Field::new("KEY".to_string(), value.to_string(), FieldKind::Integer)
}

#[test]
fn a_new_field_starts_unfocused_with_its_cursor_at_the_end() {
    let field = text("hi");
    assert!(!field.is_focused());
    assert_eq!(field.display(), "hi|");
}

#[test]
fn a_text_field_takes_any_character() {
    let mut field = text("");
    field.handle_key(KeyCode::Char('a'));
    field.handle_key(KeyCode::Char('/'));
    field.handle_key(KeyCode::Char('-'));
    assert_eq!(field.value(), "a/-");
}

#[test]
fn an_integer_field_takes_digits_and_refuses_everything_else() {
    let mut field = integer("");
    assert_eq!(
        field.handle_key(KeyCode::Char('7')),
        super::KeyOutcome::Edited
    );
    assert_eq!(
        field.handle_key(KeyCode::Char('x')),
        super::KeyOutcome::Refused("digits only")
    );
    field.handle_key(KeyCode::Char(' '));
    assert_eq!(field.value(), "7");
    assert_eq!(field.notice(), Some("digits only"));
}

#[test]
fn a_refusal_clears_on_the_next_accepted_keystroke() {
    let mut field = integer("1");
    field.handle_key(KeyCode::Char('z'));
    assert_eq!(field.notice(), Some("digits only"));
    field.handle_key(KeyCode::Char('2'));
    assert_eq!(field.notice(), None);
}

#[test]
fn enter_flips_a_toggle_but_is_ignored_by_every_other_kind() {
    let mut on = toggle(false);
    assert_eq!(on.handle_key(KeyCode::Enter), super::KeyOutcome::Edited);
    assert!(on.is_on());

    let mut text_field = text("x");
    assert_eq!(
        text_field.handle_key(KeyCode::Enter),
        super::KeyOutcome::Ignored
    );
    assert_eq!(text_field.value(), "x");
}

#[test]
fn space_flips_a_toggle_and_is_otherwise_a_character() {
    let mut field = toggle(true);
    field.handle_key(KeyCode::Char(' '));
    assert!(!field.is_on());

    // The cursor sits at the end, so a typed space lands after the existing text.
    let mut text_field = text("a b");
    text_field.handle_key(KeyCode::Char(' '));
    assert_eq!(text_field.value(), "a b ");
}

#[test]
fn a_toggle_ignores_text_editing_keys() {
    let mut field = toggle(false);
    for key in [KeyCode::Left, KeyCode::Right, KeyCode::Backspace] {
        assert_eq!(field.handle_key(key), super::KeyOutcome::Ignored);
    }
    field.handle_key(KeyCode::Char('a'));
    assert!(!field.is_on(), "a letter must not switch a checkbox on");
}

#[test]
fn a_toggle_reports_its_state_through_its_text_value() {
    let on = toggle(true);
    assert_eq!(on.value(), "on");
    assert_eq!(on.display(), "[x]");
    assert_eq!(toggle(false).display(), "[ ]");
}

#[test]
fn backspace_removes_the_character_before_the_cursor() {
    let mut field = text("hello");
    field.handle_key(KeyCode::Backspace);
    assert_eq!(field.value(), "hell");
    // One Left from the end of "hell" parks the cursor before the final "l".
    field.handle_key(KeyCode::Left);
    field.handle_key(KeyCode::Backspace);
    assert_eq!(field.value(), "hel");
}

#[test]
fn backspace_at_the_start_changes_nothing() {
    let mut field = text("hi");
    field.handle_key(KeyCode::Left);
    field.handle_key(KeyCode::Backspace);
    assert_eq!(field.value(), "i", "one character before the cursor goes");
    field.handle_key(KeyCode::Left);
    field.handle_key(KeyCode::Backspace);
    field.handle_key(KeyCode::Backspace);
    assert_eq!(field.value(), "i", "at the start nothing else does");
}

#[test]
fn arrows_stop_at_both_ends_of_an_empty_field() {
    let mut field = text("");
    for key in [KeyCode::Left, KeyCode::Right, KeyCode::Backspace] {
        field.handle_key(key);
    }
    assert_eq!(field.display(), "|");
}

#[test]
fn editing_a_multibyte_value_keeps_the_cursor_on_a_boundary() {
    let mut field = text("héllo");
    field.handle_key(KeyCode::Backspace);
    assert_eq!(field.value(), "héll");
    assert!("héll".is_char_boundary(field.display().find('|').expect("marker")));
}

#[test]
fn keys_the_field_does_not_own_are_ignored() {
    let mut field = text("x");
    for key in [KeyCode::Tab, KeyCode::F(5), KeyCode::Esc] {
        assert_eq!(field.handle_key(key), super::KeyOutcome::Ignored);
    }
    assert_eq!(field.value(), "x");
}
