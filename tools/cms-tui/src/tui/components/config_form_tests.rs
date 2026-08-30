use super::{ConfigForm, TextField};
use crossterm::event::KeyCode;

fn form_two() -> ConfigForm {
    ConfigForm::new(vec![
        ("KEY_A".to_string(), "val_a".to_string()),
        ("KEY_B".to_string(), "val_b".to_string()),
    ])
}

#[test]
fn new_builds_with_labels_and_values() {
    let form = form_two();
    let vals = form.values();
    assert_eq!(vals.len(), 2);
    assert_eq!(vals[0], ("KEY_A".to_string(), "val_a".to_string()));
    assert_eq!(vals[1], ("KEY_B".to_string(), "val_b".to_string()));
    assert_eq!(form.active, 0);
    assert!(form.fields[0].focused);
    assert!(!form.fields[1].focused);
}

#[test]
fn handle_key_down_moves_focus() {
    let mut form = form_two();
    let submitted = form.handle_key(KeyCode::Down);
    assert!(!submitted);
    assert_eq!(form.active, 1);
    assert!(!form.fields[0].focused);
    assert!(form.fields[1].focused);
}

#[test]
fn handle_key_enter_moves_focus_then_submits() {
    let mut form = form_two();
    let first = form.handle_key(KeyCode::Enter);
    assert!(!first);
    assert_eq!(form.active, 1);
    let second = form.handle_key(KeyCode::Enter);
    assert!(second);
}

#[test]
fn handle_key_enter_on_last_returns_true() {
    let mut form = ConfigForm::new(vec![("ONLY".to_string(), "x".to_string())]);
    let submitted = form.handle_key(KeyCode::Enter);
    assert!(submitted);
}

#[test]
fn typing_appends_at_cursor() {
    let mut form = ConfigForm::new(vec![("K".to_string(), "hi".to_string())]);
    form.handle_key(KeyCode::Char('!'));
    assert_eq!(form.values()[0].1, "hi!");
}

#[test]
fn typing_inserts_at_cursor_position() {
    let mut form = ConfigForm::new(vec![("K".to_string(), "ac".to_string())]);
    // cursor starts at end (2), move left once -> position 1
    form.handle_key(KeyCode::Left);
    form.handle_key(KeyCode::Char('b'));
    assert_eq!(form.values()[0].1, "abc");
}

#[test]
fn backspace_removes_char_before_cursor() {
    let mut form = ConfigForm::new(vec![("K".to_string(), "hello".to_string())]);
    form.handle_key(KeyCode::Backspace);
    assert_eq!(form.values()[0].1, "hell");
}

#[test]
fn backspace_at_start_does_nothing() {
    let mut form = ConfigForm::new(vec![("K".to_string(), "hi".to_string())]);
    form.handle_key(KeyCode::Left);
    form.handle_key(KeyCode::Left);
    // cursor at 0
    form.handle_key(KeyCode::Backspace);
    assert_eq!(form.values()[0].1, "hi");
}

#[test]
fn cursor_never_goes_negative() {
    let mut field = TextField::new("L".to_string(), "x".to_string(), true);
    field.cursor = 0;
    field.move_cursor_left();
    assert_eq!(field.cursor, 0);
    field.move_cursor_left();
    assert_eq!(field.cursor, 0);
    // via form as well
    let mut form = ConfigForm::new(vec![("K".to_string(), "hi".to_string())]);
    for _ in 0..10 {
        form.handle_key(KeyCode::Left);
    }
    assert_eq!(form.fields[0].cursor, 0);
}

#[test]
fn arrow_up_clamps_at_zero() {
    let mut form = form_two();
    // already at 0
    form.handle_key(KeyCode::Up);
    assert_eq!(form.active, 0);
    form.handle_key(KeyCode::Down);
    assert_eq!(form.active, 1);
    form.handle_key(KeyCode::Up);
    assert_eq!(form.active, 0);
    form.handle_key(KeyCode::Up);
    assert_eq!(form.active, 0);
}

#[test]
fn arrow_down_clamps_at_last() {
    let mut form = form_two();
    form.handle_key(KeyCode::Down);
    form.handle_key(KeyCode::Down);
    assert_eq!(form.active, 1);
    form.handle_key(KeyCode::Down);
    assert_eq!(form.active, 1);
}

#[test]
fn cursor_right_clamps_at_end() {
    let mut form = ConfigForm::new(vec![("K".to_string(), "ab".to_string())]);
    // start at end
    form.handle_key(KeyCode::Right);
    assert_eq!(form.fields[0].cursor, 2);
    form.handle_key(KeyCode::Left);
    form.handle_key(KeyCode::Right);
    assert_eq!(form.fields[0].cursor, 2);
}

#[test]
fn empty_form_handle_key_no_panic() {
    let mut form = ConfigForm::new(vec![]);
    assert!(!form.handle_key(KeyCode::Enter));
    assert!(!form.handle_key(KeyCode::Down));
    assert!(!form.handle_key(KeyCode::Char('x')));
    assert_eq!(form.values().len(), 0);
}
