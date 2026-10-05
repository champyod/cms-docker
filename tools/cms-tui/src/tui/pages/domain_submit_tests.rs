//! What the submit key does on each kind of row.
//!
//! WHY these are separate: the submit key is the one binding that competes with a character,
//! so its behaviour has to be read per row kind. Beside the arming and encoding tests it was
//! indistinguishable from a test about the plan the form builds.

use super::{view, DomainAction};
use ratatui::crossterm::event::KeyCode;

/// The submit key must be reachable without aiming, but only where the keystroke cannot be a
/// character the operator is typing.
#[test]
fn the_submit_key_runs_from_every_row_that_does_not_take_characters() {
    for label in ["--apply", "--staging", "--json", "--lock"] {
        let mut view = view();
        view.form_mut().focus_row(label);
        assert_eq!(
            view.handle_key(KeyCode::Char('r')),
            DomainAction::Submit,
            "{label} is a switch row, so r must run the plan"
        );
    }
}

/// `r` is a letter every domain name is made of, so a row that takes characters has to keep it.
#[test]
fn a_row_that_takes_characters_keeps_the_submit_letter() {
    for label in ["--domain", "--email", "--wait-port80"] {
        let mut view = view();
        view.form_mut().focus_row(label);
        assert_eq!(
            view.handle_key(KeyCode::Char('r')),
            DomainAction::Edited,
            "{label} takes characters, so r must be typed rather than run the plan"
        );
        assert!(
            view.form().value_of(label).contains('r'),
            "{label} did not keep the letter: {}",
            view.form().value_of(label)
        );
    }
}

#[test]
fn a_domain_name_containing_the_submit_key_can_still_be_typed() {
    let mut view = view();
    view.form_mut().focus_row("--domain");
    for key in "grader.example.com".chars() {
        assert_eq!(view.handle_key(KeyCode::Char(key)), DomainAction::Edited);
    }
    assert_eq!(view.form().value_of("--domain"), "grader.example.com");
    assert!(
        view.preview().contains("--domain grader.example.com"),
        "the typed name did not reach the argv: {}",
        view.preview()
    );
}
