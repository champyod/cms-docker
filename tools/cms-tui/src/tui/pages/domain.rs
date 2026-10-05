//! Domain page — the flag form for the `__domain.sh` verbs that take flags.
//!
//! WHY a form rather than hardcoded menu rows: every flag a run implies — staging, DNS-01,
//! the retry policy, the live `--apply` switch — was unreachable from the interface, so the
//! only way to set one was to leave the interface and remember the command-line spelling.
//! One table now drives both the display and the argv.
//!
//! WHY revocation is not a form row: it is irreversible, and a mis-aimed keystroke on a
//! form with this many rows is a much easier accident than a typed subcommand. `revoke`
//! stays reachable as a menu row, where the operator names it outright.

use super::domain_fields::{all_specs, seed_value, spec_for, FieldKind, APPLY_LABEL};
use super::domain_request::{argv, request, wants_apply};
use crate::tui::components::config_form::ConfigForm;
use ratatui::crossterm::event::KeyCode;

/// What a key press asked the page to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainAction {
    /// Stay on the page; the keystroke only moved focus or edited a row.
    Edited,
    /// Arm the live run, which needs a second key to confirm.
    Arming,
    /// Arming was confirmed and the script should be launched.
    Confirmed,
    /// Arming was abandoned; the form is back to a dry run.
    Cancelled,
    /// The operator asked to run the plan the form describes.
    Submit,
    /// Leave the form.
    Back,
    /// Nothing this page owns.
    Ignored,
}

/// The domain form and the two-step arming of a live run.
///
/// WHY a separate `is_arming` state instead of letting one key flip `--apply` directly: a
/// live run reissues certificates and reloads nginx, and the operator has to be able to
/// see that this run is live before it starts. One deliberate key opens the question, a
/// second answers it.
pub struct DomainView {
    form: ConfigForm,
    verb: String,
    is_arming: bool,
    last_argv: Vec<String>,
}

impl DomainView {
    /// Builds the form from what this box currently has configured.
    #[must_use]
    pub fn from_values(verb: &str, current: &[(&str, &str)]) -> Self {
        Self::new(verb, build_form(current))
    }

    #[must_use]
    pub fn new(verb: &str, form: ConfigForm) -> Self {
        Self {
            form,
            verb: verb.to_string(),
            is_arming: false,
            last_argv: Vec::new(),
        }
    }

    #[must_use]
    pub const fn form(&self) -> &ConfigForm {
        &self.form
    }

    /// The form itself, so a caller can move focus before handing it a keystroke.
    pub const fn form_mut(&mut self) -> &mut ConfigForm {
        &mut self.form
    }

    /// The script verb this form submits.
    #[must_use]
    pub fn verb(&self) -> &str {
        &self.verb
    }

    /// Whether the live-run question is open and waiting for a yes.
    #[must_use]
    pub const fn is_arming(&self) -> bool {
        self.is_arming
    }

    /// Whether the form currently describes a live run rather than a dry run.
    #[must_use]
    pub fn is_apply(&self) -> bool {
        wants_apply(&self.form)
    }

    /// The exact argv this form would hand the script right now.
    ///
    /// WHY rendered on the page: the operator is about to run something that reissues a
    /// certificate, and the flags it will pass should be readable before it does rather
    /// than discovered in a log afterwards.
    #[must_use]
    pub fn preview(&self) -> String {
        argv(&self.form, &self.verb).join(" ")
    }

    /// Handles one key press on the form.
    ///
    /// Returns [`DomainAction::Ignored`] for keys that belong to another page, so the
    /// caller can fall through instead of swallowing them.
    pub fn handle_key(&mut self, key: KeyCode) -> DomainAction {
        if self.is_arming {
            return self.handle_arming_key(key);
        }
        match key {
            KeyCode::Char('a' | 'A' | ' ') if self.is_on_apply_row() => self.arm(),
            KeyCode::Char('r' | 'R') if !self.is_on_typing_row() => DomainAction::Submit,
            KeyCode::Esc => DomainAction::Back,
            KeyCode::Enter if self.form.is_focused_row(APPLY_LABEL) => self.arm(),
            _ if is_typing_key(key) => {
                self.form.handle_key(key);
                DomainAction::Edited
            }
            _ => {
                self.form.handle_key(key);
                DomainAction::Edited
            }
        }
    }

    /// The live-run question: only `y` arms it, and anything else steps back.
    fn handle_arming_key(&mut self, key: KeyCode) -> DomainAction {
        self.is_arming = false;
        match key {
            KeyCode::Char('y' | 'Y') => {
                self.set_apply(true);
                DomainAction::Confirmed
            }
            _ => DomainAction::Cancelled,
        }
    }

    /// Opens the live-run question, or reports that the row is already armed.
    fn arm(&mut self) -> DomainAction {
        if self.is_apply() {
            self.set_apply(false);
            return DomainAction::Cancelled;
        }
        self.is_arming = true;
        DomainAction::Arming
    }

    /// Records the argv a run used, so the page can show what was actually launched.
    pub fn note_run(&mut self, args: Vec<String>) {
        self.last_argv = args;
    }

    /// The argv of the last run on this form.
    #[must_use]
    pub fn last_run(&self) -> &[String] {
        &self.last_argv
    }

    fn is_on_apply_row(&self) -> bool {
        self.form.is_focused_row(APPLY_LABEL)
    }

    /// Whether focus sits on a row the operator types into rather than flips.
    ///
    /// WHY the submit key is guarded on this: `r` is a letter every domain name is made of, so
    /// an unguarded binding ran the plan partway through typing one, and a name could not be
    /// entered at all.
    fn is_on_typing_row(&self) -> bool {
        self.form.focused_label().is_some_and(is_typing_row)
    }

    fn set_apply(&mut self, is_on: bool) {
        if is_on != self.is_apply() {
            self.form.flip_row(APPLY_LABEL);
        }
    }
}

/// Builds the editable form, seeding each row from what the box currently has.
fn build_form(current: &[(&str, &str)]) -> ConfigForm {
    let rows: Vec<(String, String)> = all_specs()
        .map(|spec| {
            let known = current
                .iter()
                .find(|(key, _)| spec.key == Some(key))
                .map_or("", |(_, value)| value);
            (spec.label.to_string(), seed_value(spec, known))
        })
        .collect();
    ConfigForm::new(rows)
}

/// Whether `key` is a character a text or integer row could accept.
///
/// WHY Home, the arrows and Backspace are excluded here: they navigate or edit, and a form
/// row that swallowed them would make the page's own bindings unreachable.
const fn is_typing_key(key: KeyCode) -> bool {
    matches!(key, KeyCode::Char(_) | KeyCode::Backspace)
}

/// Whether `label` names a row the operator types into rather than flips.
///
/// WHY text and number rows together: both take characters from the keyboard, so both have to
/// keep the letters a page binding would otherwise claim. A switch row takes no characters, so
/// a letter pressed on one is free to be a binding.
#[must_use]
pub fn is_typing_row(label: &str) -> bool {
    spec_for(label).is_some_and(|spec| matches!(spec.kind, FieldKind::Text | FieldKind::Integer))
}

/// Projects the form onto the shared request, for a caller that runs the argv itself.
#[must_use]
pub fn submit_request(view: &DomainView) -> crate::core::domain_setup::DomainSetupRequest {
    request(view.form())
}

/// The keys the page's own help line advertises.
pub const HELP: &str =
    "[↑/↓] Row   [Space] Toggle   [a] Arm live run   [r] Run on a switch   [Esc] Back   [1-9] Page   [q] Quit";

#[cfg(test)]
#[path = "domain_tests.rs"]
mod tests;
