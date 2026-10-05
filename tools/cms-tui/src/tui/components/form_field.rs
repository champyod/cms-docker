//! Editable form field kinds: text, toggle and integer.
//!
//! WHY three kinds rather than one free-text field: the domain flags are not all
//! strings. A toggle typed as text invites `--staging false` reaching the script, and
//! an integer field that accepted letters would produce an argv the script aborts on
//! after the operator had already pressed apply. Rejecting the wrong keystroke at the
//! field keeps bad argv from ever being built.

use crossterm::event::KeyCode;

use super::edit_cursor::{EditCursor, KeyOutcome};

/// The kinds of value a form field can hold.
///
/// WHY `Copy`: a spec is declared once in the field table and read many times while a
/// form is built, and cloning a field kind per read would make the table's `const`
/// construction impossible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKind {
    /// Free text; any character is accepted.
    Text,
    /// A checkbox; Space and Enter both flip it.
    Toggle { is_on: bool },
    /// Digits only, because `__domain.sh` aborts on a non-numeric count or timeout.
    Integer,
}

/// One editable row of a [`crate::tui::components::config_form::ConfigForm`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    label: String,
    value: String,
    kind: FieldKind,
    cursor: EditCursor,
    is_focused: bool,
    /// Why the last keystroke was refused, shown until the next edit.
    notice: Option<&'static str>,
}

/// The message an integer field shows for a keystroke it will not take.
const DIGITS_ONLY: &str = "digits only";

impl Field {
    /// Builds a field of `kind` with its cursor at the end of `value`.
    #[must_use]
    pub fn new(label: String, value: String, kind: FieldKind) -> Self {
        let cursor = EditCursor::at_end(&value);
        Self {
            label,
            value,
            kind,
            cursor,
            is_focused: false,
            notice: None,
        }
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    #[must_use]
    pub const fn kind(&self) -> &FieldKind {
        &self.kind
    }

    #[must_use]
    pub const fn is_focused(&self) -> bool {
        self.is_focused
    }

    /// Whether the last keystroke was refused for this field.
    #[must_use]
    pub const fn notice(&self) -> Option<&'static str> {
        self.notice
    }

    /// Marks the field focused and parks its cursor.
    pub(crate) const fn set_focused(&mut self, is_focused: bool) {
        self.is_focused = is_focused;
    }

    /// Whether this field is a checkbox, which changes what Enter means.
    #[must_use]
    pub const fn is_toggle(&self) -> bool {
        matches!(self.kind, FieldKind::Toggle { .. })
    }

    /// The current boolean, for a [`FieldKind::Toggle`].
    ///
    /// A toggle's text is derived from the kind rather than typed, so this is the only
    /// way to read it and the value can never drift out of step with the checkbox.
    #[must_use]
    pub const fn is_on(&self) -> bool {
        matches!(self.kind, FieldKind::Toggle { is_on: true })
    }

    /// The value as the form's readers see it.
    ///
    /// A toggle reports `on`/`off` here so `ConfigForm::value_of` stays total: the
    /// domain page reads some rows as text and some as booleans through one accessor.
    #[must_use]
    pub const fn value(&self) -> &str {
        match self.kind {
            FieldKind::Toggle { is_on: true } => "on",
            FieldKind::Toggle { is_on: false } => "off",
            FieldKind::Text | FieldKind::Integer => self.value.as_str(),
        }
    }

    /// The text with a `|` at the cursor, for the focused text row.
    #[must_use]
    pub fn display(&self) -> String {
        if let FieldKind::Toggle { .. } = self.kind {
            return format!("[{}]", if self.is_on() { "x" } else { " " });
        }
        let cursor = self.cursor.clamped(&self.value).offset();
        let mut out = String::with_capacity(self.value.len() + 1);
        out.push_str(&self.value[..cursor]);
        out.push('|');
        out.push_str(&self.value[cursor..]);
        out
    }

    /// Applies one keystroke to this field.
    pub(crate) fn handle_key(&mut self, key: KeyCode) -> KeyOutcome {
        if matches!(self.kind, FieldKind::Toggle { .. }) {
            return self.handle_toggle_key(key);
        }
        match key {
            KeyCode::Left => self.move_cursor(KeyCode::Left),
            KeyCode::Right => self.move_cursor(KeyCode::Right),
            KeyCode::Backspace => self.delete_before_cursor(),
            KeyCode::Char(ch) => self.insert_char(ch),
            _ => KeyOutcome::Ignored,
        }
    }

    /// A checkbox answers only the two keys that mean "yes".
    ///
    /// WHY everything else is refused: Left and Backspace have no meaning on a checkbox,
    /// and letting a letter through would insert it into the toggle's stored value, which
    /// is derived from the kind and would silently drop it.
    const fn handle_toggle_key(&mut self, key: KeyCode) -> KeyOutcome {
        match key {
            KeyCode::Enter | KeyCode::Char(' ') => self.flip(),
            _ => KeyOutcome::Ignored,
        }
    }

    const fn flip(&mut self) -> KeyOutcome {
        if let FieldKind::Toggle { is_on } = self.kind {
            self.kind = FieldKind::Toggle { is_on: !is_on };
            self.notice = None;
            return KeyOutcome::Edited;
        }
        KeyOutcome::Ignored
    }

    fn move_cursor(&mut self, key: KeyCode) -> KeyOutcome {
        match key {
            KeyCode::Left => self.cursor.back(&self.value),
            KeyCode::Right => self.cursor.forward(&self.value),
            _ => return KeyOutcome::Ignored,
        }
        KeyOutcome::Edited
    }

    fn delete_before_cursor(&mut self) -> KeyOutcome {
        let at = self.cursor.clamped(&self.value).offset();
        if at == 0 || self.value.is_empty() {
            return KeyOutcome::Ignored;
        }
        let mut probe = self.cursor;
        probe.back(&self.value);
        let start = probe.offset();
        self.value.drain(start..at);
        self.cursor = probe;
        self.notice = None;
        KeyOutcome::Edited
    }

    fn insert_char(&mut self, ch: char) -> KeyOutcome {
        if self.refuses(ch) {
            self.notice = Some(DIGITS_ONLY);
            return KeyOutcome::Refused(DIGITS_ONLY);
        }
        let at = self.cursor.clamped(&self.value).offset();
        self.value.insert(at, ch);
        self.cursor = EditCursor::at(at + ch.len_utf8());
        self.notice = None;
        KeyOutcome::Edited
    }

    /// Whether this field kind refuses `ch`.
    const fn refuses(&self, ch: char) -> bool {
        matches!(self.kind, FieldKind::Integer) && !ch.is_ascii_digit()
    }
}

#[cfg(test)]
#[path = "form_field_tests.rs"]
mod tests;
