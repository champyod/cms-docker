use ratatui::{crossterm::event::KeyCode, layout::Rect, Frame};

use super::action_view;

pub struct MenuItem {
    pub label: String,
    pub description: String,
    pub requires_tty: bool,
    pub requires_sudo: bool,
    pub capture_output: bool,
}

pub struct ActionMenu {
    items: Vec<MenuItem>,
    selected: usize,
}

impl ActionMenu {
    #[must_use]
    pub fn new(items: Vec<(String, String)>) -> Self {
        Self::with_meta(
            items
                .into_iter()
                .map(|(label, description)| (label, description, false, false, false))
                .collect(),
        )
    }

    #[must_use]
    pub fn with_meta(items: Vec<(String, String, bool, bool, bool)>) -> Self {
        let mapped: Vec<MenuItem> = items
            .into_iter()
            .map(
                |(label, description, requires_tty, requires_sudo, capture_output)| MenuItem {
                    label,
                    description,
                    requires_tty,
                    requires_sudo,
                    capture_output,
                },
            )
            .collect();
        Self {
            items: mapped,
            selected: 0,
        }
    }

    pub const fn handle_key(&mut self, key: KeyCode) -> Option<usize> {
        if self.items.is_empty() {
            return None;
        }
        match key {
            KeyCode::Down | KeyCode::Char('j') => {
                if self.selected + 1 < self.items.len() {
                    self.selected += 1;
                }
                None
            }
            KeyCode::Up | KeyCode::Char('k') => {
                if self.selected > 0 {
                    self.selected -= 1;
                }
                None
            }
            KeyCode::Enter => Some(self.selected),
            _ => None,
        }
    }

    #[must_use]
    pub const fn selected(&self) -> usize {
        self.selected
    }

    #[must_use]
    pub fn selected_label(&self) -> &str {
        let Some(item) = self.current_item() else {
            return "";
        };
        item.label.as_str()
    }

    /// The command the selected item runs.
    ///
    /// Distinct from the label: the label is what the user reads, the command
    /// is what gets executed. Consumers must run this, never the label.
    #[must_use]
    pub fn selected_command(&self) -> &str {
        let Some(item) = self.current_item() else {
            return "";
        };
        item.description.as_str()
    }

    #[must_use]
    pub const fn len(&self) -> usize {
        self.items.len()
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    #[must_use]
    pub fn get_item(&self, index: usize) -> Option<&MenuItem> {
        self.items.get(index)
    }

    /// The rows in draw order, so the view can paint them without knowing how
    /// the menu keeps its cursor.
    #[must_use]
    pub fn items(&self) -> &[MenuItem] {
        &self.items
    }

    pub fn render(&self, f: &mut Frame, area: Rect, title: &str) {
        action_view::render(self, f, area, title);
    }

    /// `None` for an empty menu, so a caller can draw a placeholder instead of
    /// indexing past the end of the row list.
    fn current_item(&self) -> Option<&MenuItem> {
        self.items.get(self.selected)
    }
}

#[cfg(test)]
#[path = "action_menu_tests.rs"]
mod tests;
