use crossterm::event::KeyCode;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

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
        let mapped: Vec<MenuItem> = items
            .into_iter()
            .map(|(label, description)| MenuItem {
                label,
                description,
                requires_tty: false,
                requires_sudo: false,
                capture_output: false,
            })
            .collect();
        Self {
            items: mapped,
            selected: 0,
        }
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
        if self.items.is_empty() {
            return "";
        }
        self.items[self.selected].label.as_str()
    }

    /// The command the selected item runs.
    ///
    /// Distinct from the label: the label is what the user reads, the command
    /// is what gets executed. Consumers must run this, never the label.
    #[must_use]
    pub fn selected_command(&self) -> &str {
        if self.items.is_empty() {
            return "";
        }
        self.items[self.selected].description.as_str()
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

    pub fn render(&self, f: &mut Frame, area: Rect, title: &str) {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(title.to_string());
        if self.items.is_empty() {
            let paragraph = Paragraph::new("(no actions)")
                .style(Style::default().add_modifier(Modifier::DIM))
                .block(block);
            f.render_widget(paragraph, area);
            return;
        }
        let mut lines: Vec<Line> = Vec::new();
        for (index, item) in self.items.iter().enumerate() {
            let is_selected: bool = index == self.selected;
            let label_style: Style = if is_selected {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            let marker: &str = if is_selected { ">" } else { " " };
            let label_line = Line::from(Span::styled(
                format!("{} {}", marker, item.label),
                label_style,
            ));
            lines.push(label_line);
            let desc_line = Line::from(Span::styled(
                format!("  {}", item.description),
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::DIM),
            ));
            lines.push(desc_line);
        }
        let paragraph = Paragraph::new(lines).block(block);
        f.render_widget(paragraph, area);
    }
}

#[cfg(test)]
mod tests {
    use super::{ActionMenu, MenuItem};
    use crossterm::event::KeyCode;

    fn sample_menu() -> ActionMenu {
        ActionMenu::new(vec![
            (
                "Deploy Core Stack".to_string(),
                "deploy core services".to_string(),
            ),
            ("Run Backup".to_string(), "backup database".to_string()),
            (
                "Restart Worker".to_string(),
                "restart worker fleet".to_string(),
            ),
        ])
    }

    #[test]
    fn new_builds_items() {
        let menu: ActionMenu = sample_menu();
        assert_eq!(menu.len(), 3);
        assert!(!menu.is_empty());
        assert_eq!(menu.selected(), 0);
        assert_eq!(menu.selected_label(), "Deploy Core Stack");
    }

    #[test]
    fn handle_key_enter_returns_index() {
        let mut menu: ActionMenu = sample_menu();
        let result: Option<usize> = menu.handle_key(KeyCode::Enter);
        assert_eq!(result, Some(0));
        menu.handle_key(KeyCode::Down);
        let result_second: Option<usize> = menu.handle_key(KeyCode::Enter);
        assert_eq!(result_second, Some(1));
    }

    #[test]
    fn up_down_moves_and_clamps() {
        let mut menu: ActionMenu = sample_menu();
        assert_eq!(menu.selected(), 0);
        menu.handle_key(KeyCode::Up);
        assert_eq!(menu.selected(), 0);
        menu.handle_key(KeyCode::Down);
        assert_eq!(menu.selected(), 1);
        menu.handle_key(KeyCode::Down);
        assert_eq!(menu.selected(), 2);
        menu.handle_key(KeyCode::Down);
        assert_eq!(menu.selected(), 2);
        menu.handle_key(KeyCode::Up);
        assert_eq!(menu.selected(), 1);
        menu.handle_key(KeyCode::Up);
        assert_eq!(menu.selected(), 0);
        menu.handle_key(KeyCode::Up);
        assert_eq!(menu.selected(), 0);
    }

    #[test]
    fn never_goes_out_of_bounds() {
        let mut menu: ActionMenu = sample_menu();
        for _ in 0..10 {
            menu.handle_key(KeyCode::Down);
        }
        assert!(menu.selected() < menu.len());
        for _ in 0..10 {
            menu.handle_key(KeyCode::Up);
        }
        assert!(menu.selected() < menu.len());
    }

    #[test]
    fn j_k_vim_style_moves() {
        let mut menu: ActionMenu = sample_menu();
        menu.handle_key(KeyCode::Char('j'));
        assert_eq!(menu.selected(), 1);
        menu.handle_key(KeyCode::Char('j'));
        assert_eq!(menu.selected(), 2);
        menu.handle_key(KeyCode::Char('k'));
        assert_eq!(menu.selected(), 1);
        menu.handle_key(KeyCode::Char('k'));
        assert_eq!(menu.selected(), 0);
        menu.handle_key(KeyCode::Char('k'));
        assert_eq!(menu.selected(), 0);
        menu.handle_key(KeyCode::Char('j'));
        menu.handle_key(KeyCode::Char('j'));
        menu.handle_key(KeyCode::Char('j'));
        assert_eq!(menu.selected(), 2);
    }

    #[test]
    fn selected_label_reflects_current_selection() {
        let mut menu: ActionMenu = sample_menu();
        assert_eq!(menu.selected_label(), "Deploy Core Stack");
        menu.handle_key(KeyCode::Down);
        assert_eq!(menu.selected_label(), "Run Backup");
        menu.handle_key(KeyCode::Down);
        assert_eq!(menu.selected_label(), "Restart Worker");
        menu.handle_key(KeyCode::Up);
        assert_eq!(menu.selected_label(), "Run Backup");
    }

    /// Guards the label/command distinction: the menu shows a label, but the
    /// runner must spawn the command. Running the label yields exit 127.
    #[test]
    fn selected_command_is_the_command_not_the_label() {
        let mut menu: ActionMenu = sample_menu();
        assert_ne!(menu.selected_command(), menu.selected_label());
        assert_eq!(menu.selected_command(), sample_menu().selected_command());
        menu.handle_key(KeyCode::Down);
        assert_ne!(menu.selected_command(), menu.selected_label());
    }

    #[test]
    fn empty_menu_behavior() {
        let mut menu: ActionMenu = ActionMenu::new(vec![]);
        assert_eq!(menu.len(), 0);
        assert!(menu.is_empty());
        assert_eq!(menu.selected_label(), "");
        let result: Option<usize> = menu.handle_key(KeyCode::Enter);
        assert_eq!(result, None);
        let result_down: Option<usize> = menu.handle_key(KeyCode::Down);
        assert_eq!(result_down, None);
        let result_up: Option<usize> = menu.handle_key(KeyCode::Up);
        assert_eq!(result_up, None);
        let result_j: Option<usize> = menu.handle_key(KeyCode::Char('j'));
        assert_eq!(result_j, None);
        assert_eq!(menu.selected(), 0);
    }

    #[test]
    fn handle_key_other_keys_return_none() {
        let mut menu: ActionMenu = sample_menu();
        assert_eq!(menu.handle_key(KeyCode::Char('x')), None);
        assert_eq!(menu.handle_key(KeyCode::Esc), None);
        assert_eq!(menu.selected(), 0);
    }

    #[test]
    fn with_meta_preserves_tty_and_sudo_flags() {
        let menu = ActionMenu::with_meta(vec![(
            "Edit config.toml".to_string(),
            "nano config.toml".to_string(),
            true,
            false,
            false,
        )]);
        let item: &MenuItem = menu.get_item(0).unwrap();
        assert!(item.requires_tty);
        assert!(!item.requires_sudo);
        assert!(!item.capture_output);
    }

    #[test]
    fn new_defaults_to_non_tty() {
        let menu = ActionMenu::new(vec![("Label".to_string(), "cmd".to_string())]);
        let item: &MenuItem = menu.get_item(0).unwrap();
        assert!(!item.requires_tty);
        assert!(!item.requires_sudo);
    }
}
