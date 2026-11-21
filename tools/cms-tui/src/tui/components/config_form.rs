//! Focus engine over a list of [`Field`]s.
//!
//! WHY the form owns focus and nothing else: field kinds own editing, and the page that
//! builds the form owns rendering, so a new kind never has to touch navigation.

use crossterm::event::KeyCode;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use super::edit_cursor::KeyOutcome;
use super::form_field::{Field, FieldKind};

/// A vertical list of fields with exactly one focused at a time.
///
/// WHY `handle_key` returns a [`KeyOutcome`]: the page needs to know whether the
/// keystroke was consumed by a field, refused by one, or left over for form-level
/// bindings such as submit and cancel. A plain `bool` cannot express the third case,
/// and guessing is how `s` stops working as submit once a text field exists.
pub struct ConfigForm {
    fields: Vec<Field>,
    active: usize,
}

impl ConfigForm {
    #[must_use]
    pub fn new(fields: Vec<Field>) -> Self {
        let mut form = Self { fields, active: 0 };
        form.apply_focus();
        form
    }

    /// Builds a form of plain text fields, all focused in turn.
    #[must_use]
    pub fn from_text_fields(fields: Vec<(String, String)>) -> Self {
        Self::new(
            fields
                .into_iter()
                .map(|(label, value)| Field::new(label, value, FieldKind::Text))
                .collect(),
        )
    }

    /// The fields, in display order.
    #[must_use]
    pub fn fields(&self) -> &[Field] {
        &self.fields
    }

    #[must_use]
    pub const fn len(&self) -> usize {
        self.fields.len()
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    #[must_use]
    pub const fn active(&self) -> usize {
        self.active
    }

    /// Index of the field carrying `label`, if this form has one.
    #[must_use]
    pub fn index_of(&self, label: &str) -> Option<usize> {
        self.fields.iter().position(|field| field.label() == label)
    }

    /// The value of the field carrying `label`.
    ///
    /// A missing field is not an error here: the page built this form from the same
    /// table, so a label it cannot find means the table is wrong, and `""` lets the
    /// caller fall back to the script default instead of panicking on a keystroke.
    #[must_use]
    pub fn value_of(&self, label: &str) -> &str {
        self.index_of(label)
            .and_then(|index| self.fields.get(index))
            .map_or("", Field::value)
    }

    /// Whether the toggle carrying `label` is on; an unknown label reads as off.
    #[must_use]
    pub fn is_on(&self, label: &str) -> bool {
        self.index_of(label)
            .and_then(|index| self.fields.get(index))
            .is_some_and(Field::is_on)
    }

    /// The numeric value of `label`, or `None` when blank or unparseable.
    #[must_use]
    pub fn number_of(&self, label: &str) -> Option<u32> {
        self.value_of(label).trim().parse().ok()
    }

    /// Whether the field carrying `label` refused the last keystroke.
    #[must_use]
    pub fn notice_of(&self, label: &str) -> Option<&'static str> {
        self.index_of(label)
            .and_then(|index| self.fields.get(index))
            .and_then(Field::notice)
    }

    /// Parks focus on the row named `label`, doing nothing when the form has no such row.
    ///
    /// WHY by label rather than by index: the domain page's rows come from a table, so a
    /// test that counted rows would break every time a flag was added to the form.
    pub fn goto_row(&mut self, label: &str) {
        if let Some(index) = self.index_of(label) {
            self.set_active(index);
        }
    }

    /// Whether focus is on the row named `label`.
    ///
    /// WHY the page asks this rather than tracking its own row index: the apply row is a
    /// table entry like every other, so a hand-tracked index would drift the moment a
    /// flag was inserted above it.
    #[must_use]
    pub fn is_focused_row(&self, label: &str) -> bool {
        self.active() == self.index_of(label).unwrap_or(usize::MAX)
    }

    /// Flips the toggle named `label`, reporting whether there was one to flip.
    ///
    /// WHY this and not a key press: arming a live run is not a keystroke the operator
    /// typed into the row, and routing it through `handle_key` would make the page's
    /// confirm step indistinguishable from editing the field.
    pub fn flip_row(&mut self, label: &str) -> bool {
        let Some(index) = self.index_of(label) else {
            return false;
        };
        self.set_active(index);
        self.edit_active(KeyCode::Char(' ')).is_edited()
    }

    /// Applies one keystroke to the focused field, moving focus for navigation keys.
    ///
    /// Enter is a navigation key for text and integer rows, and flips a checkbox
    /// instead: a checkbox has no other way to accept focus, and this page's own submit
    /// binding is a different key, so Enter cannot be doing two jobs at once.
    pub fn handle_key(&mut self, key: KeyCode) -> KeyOutcome {
        if self.fields.is_empty() {
            return KeyOutcome::Ignored;
        }
        let is_toggle = self.active_field().is_some_and(Field::is_toggle);
        if is_toggle && key == KeyCode::Enter {
            return self.edit_active(key);
        }
        if self.navigate(key) {
            return KeyOutcome::Edited;
        }
        self.edit_active(key)
    }

    fn edit_active(&mut self, key: KeyCode) -> KeyOutcome {
        self.active_field_mut()
            .map_or(KeyOutcome::Ignored, |field| field.handle_key(key))
    }

    /// Moves focus for the navigation keys, reporting whether it took one.
    fn navigate(&mut self, key: KeyCode) -> bool {
        let next = match key {
            KeyCode::Down | KeyCode::Tab => self.active + 1,
            KeyCode::Up | KeyCode::BackTab => self.active.saturating_sub(1),
            KeyCode::Enter | KeyCode::Home => {
                if key == KeyCode::Home {
                    0
                } else {
                    self.active + 1
                }
            }
            _ => return false,
        };
        self.set_active(next);
        true
    }

    fn set_active(&mut self, requested: usize) {
        self.active = requested.min(self.fields.len().saturating_sub(1));
        self.apply_focus();
    }

    fn apply_focus(&mut self) {
        for (index, field) in self.fields.iter_mut().enumerate() {
            field.set_focused(index == self.active);
        }
    }

    fn active_field(&self) -> Option<&Field> {
        if self.fields.is_empty() {
            return None;
        }
        self.fields.get(self.active)
    }

    fn active_field_mut(&mut self) -> Option<&mut Field> {
        if self.fields.is_empty() {
            return None;
        }
        self.fields.get_mut(self.active)
    }

    pub fn render(&self, f: &mut Frame, area: Rect) {
        if self.fields.is_empty() {
            return;
        }
        let constraints: Vec<Constraint> =
            self.fields.iter().map(|_| Constraint::Length(1)).collect();
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(area);

        for (index, field) in self.fields.iter().enumerate() {
            let Some(chunk) = chunks.get(index) else {
                return;
            };
            let block = Block::default().borders(Borders::ALL).title(field.label());
            let style = if field.is_focused() {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            f.render_widget(
                Paragraph::new(field.display()).block(block.style(style)),
                *chunk,
            );
        }
    }
}

#[cfg(test)]
#[path = "config_form_tests.rs"]
mod tests;
