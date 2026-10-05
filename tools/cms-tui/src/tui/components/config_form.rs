use crate::tui::pages::domain_fields;
use ratatui::{
    crossterm::event::KeyCode,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

pub struct TextField {
    label: String,
    value: String,
    cursor: usize,
    focused: bool,
}

impl TextField {
    const fn new(label: String, value: String, focused: bool) -> Self {
        let cursor = value.len();
        Self {
            label,
            value,
            cursor,
            focused,
        }
    }

    fn insert_char(&mut self, ch: char) {
        let clamped = self.cursor.min(self.value.len());
        self.value.insert(clamped, ch);
        self.cursor = clamped + ch.len_utf8();
        // Clamp to value length (handles multi-byte but keeps byte index valid)
        if self.cursor > self.value.len() {
            self.cursor = self.value.len();
        }
    }

    fn delete_before_cursor(&mut self) {
        if self.cursor == 0 || self.value.is_empty() {
            return;
        }
        let clamped = self.cursor.min(self.value.len());
        if clamped == 0 {
            return;
        }
        // Find previous char boundary
        let prev = self.value[..clamped]
            .char_indices()
            .last()
            .map_or(0, |(idx, _)| idx);
        self.value.drain(prev..clamped);
        self.cursor = prev;
    }

    fn move_cursor_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let clamped = self.cursor.min(self.value.len());
        if clamped == 0 {
            self.cursor = 0;
            return;
        }
        let prev = self.value[..clamped]
            .char_indices()
            .last()
            .map_or(0, |(idx, _)| idx);
        self.cursor = prev;
    }

    fn move_cursor_right(&mut self) {
        if self.cursor >= self.value.len() {
            self.cursor = self.value.len();
            return;
        }
        let clamped = self.cursor.min(self.value.len());
        if clamped >= self.value.len() {
            return;
        }
        let ch_len = self.value[clamped..]
            .chars()
            .next()
            .map_or(1, char::len_utf8);
        self.cursor = (clamped + ch_len).min(self.value.len());
    }
}

/// Config form with field focus handling.
///
/// WHY: `handle_key` — Enter advances focus; on last field returns `true` to
/// signal submit without an extra pseudo-field. Caller interprets `true` as
/// "form submitted / confirmed".
pub struct ConfigForm {
    fields: Vec<TextField>,
    active: usize,
}

impl ConfigForm {
    #[must_use]
    pub fn new(fields: Vec<(String, String)>) -> Self {
        let mut text_fields: Vec<TextField> = fields
            .into_iter()
            .enumerate()
            .map(|(idx, (label, value))| TextField::new(label, value, idx == 0))
            .collect();
        // Ensure focused state consistent even if empty
        for (idx, field) in text_fields.iter_mut().enumerate() {
            field.focused = idx == 0;
        }
        Self {
            fields: text_fields,
            active: 0,
        }
    }

    #[must_use]
    pub fn values(&self) -> Vec<(String, String)> {
        self.fields
            .iter()
            .map(|field| (field.label.clone(), field.value.clone()))
            .collect()
    }

    /// The value of the row carrying `label`.
    ///
    /// WHY a missing row reads as blank instead of panicking: a page builds this form
    /// from its own row table, so a label it cannot find means that table is wrong, and
    /// a keystroke should not be able to take the interface down over it.
    #[must_use]
    pub fn value_of(&self, label: &str) -> &str {
        self.fields
            .iter()
            .find(|field| field.label == label)
            .map_or("", |field| field.value.as_str())
    }

    /// The labels, in display order.
    #[must_use]
    pub fn labels(&self) -> Vec<String> {
        self.fields
            .iter()
            .map(|field| field.label.clone())
            .collect()
    }

    /// Whether focus is on the row named `label`.
    #[must_use]
    pub fn is_focused_row(&self, label: &str) -> bool {
        self.fields
            .get(self.active)
            .is_some_and(|field| field.label == label)
    }

    /// Parks focus on the row named `label`, doing nothing when the form has no such row.
    ///
    /// WHY by label rather than by index: rows come from a table, so a count-based
    /// position breaks every time a flag is added above the one being aimed at.
    pub fn focus_row(&mut self, label: &str) {
        if let Some(index) = self.index_of(label) {
            self.set_active(index);
        }
    }

    /// Flips the row named `label` between the two words a switch reports.
    ///
    /// WHY a method rather than a keystroke: arming a live run is not text the operator
    /// typed into the row, and routing it through `handle_key` would make the page's own
    /// confirm step indistinguishable from editing the field.
    pub fn flip_row(&mut self, label: &str) -> bool {
        let Some(index) = self.index_of(label) else {
            return false;
        };
        let Some(field) = self.fields.get_mut(index) else {
            return false;
        };
        let is_on = domain_fields::is_truthy(&field.value);
        field.value = domain_fields::on_off(!is_on);
        true
    }

    fn index_of(&self, label: &str) -> Option<usize> {
        self.fields.iter().position(|field| field.label == label)
    }

    fn set_active(&mut self, next: usize) {
        if self.fields.is_empty() {
            return;
        }
        let clamped = next.min(self.fields.len() - 1);
        for (idx, field) in self.fields.iter_mut().enumerate() {
            field.focused = idx == clamped;
        }
        self.active = clamped;
    }

    fn active_field_mut(&mut self) -> Option<&mut TextField> {
        if self.fields.is_empty() {
            return None;
        }
        let idx = self.active.min(self.fields.len() - 1);
        self.fields.get_mut(idx)
    }

    pub fn handle_key(&mut self, key: KeyCode) -> bool {
        if self.fields.is_empty() {
            return false;
        }
        match key {
            KeyCode::Down => {
                let next = (self.active + 1).min(self.fields.len() - 1);
                self.set_active(next);
                false
            }
            KeyCode::Up => {
                let next = self.active.saturating_sub(1);
                self.set_active(next);
                false
            }
            KeyCode::Enter => {
                if self.active >= self.fields.len() - 1 {
                    true
                } else {
                    let next = self.active + 1;
                    self.set_active(next);
                    false
                }
            }
            KeyCode::Left => {
                if let Some(field) = self.active_field_mut() {
                    field.move_cursor_left();
                }
                false
            }
            KeyCode::Right => {
                if let Some(field) = self.active_field_mut() {
                    field.move_cursor_right();
                }
                false
            }
            KeyCode::Backspace => {
                if let Some(field) = self.active_field_mut() {
                    field.delete_before_cursor();
                }
                false
            }
            KeyCode::Char(ch) => {
                if let Some(field) = self.active_field_mut() {
                    field.insert_char(ch);
                }
                false
            }
            _ => false,
        }
    }

    pub fn render(&self, f: &mut Frame, area: Rect) {
        if self.fields.is_empty() {
            return;
        }
        let constraints: Vec<Constraint> =
            self.fields.iter().map(|_| Constraint::Length(3)).collect();
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints(constraints)
            .split(area);

        for (idx, field) in self.fields.iter().enumerate() {
            let display = build_display_value(field);
            let block = Block::default()
                .borders(Borders::ALL)
                .title(field.label.as_str());
            let style = if field.focused {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            let paragraph = Paragraph::new(display).block(block.style(style));
            if let Some(chunk) = chunks.get(idx) {
                f.render_widget(paragraph, *chunk);
            }
        }
    }
}

fn build_display_value(field: &TextField) -> String {
    let cursor = field.cursor.min(field.value.len());
    let mut out = String::with_capacity(field.value.len() + 1);
    out.push_str(&field.value[..cursor]);
    out.push('_');
    out.push_str(&field.value[cursor..]);
    out
}

#[cfg(test)]
#[path = "config_form_tests.rs"]
mod tests;
