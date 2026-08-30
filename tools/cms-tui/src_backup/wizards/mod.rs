//! Wizards tab: db-host settings, expose wiring, server connections.

use crossterm::event::KeyCode;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::App;
use crate::data::env;
use crate::ui::widgets;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Section {
    #[default]
    Menu,
    DbHost,
    Expose,
    Server,
}

#[derive(Default)]
pub struct WizardScreen {
    pub section: Section,
    pub cursor: usize,
    input: String,
    toast_msg: Option<String>,
}

const MENU: [&str; 3] = [
    "DB host defaults (.env.worker)",
    "Expose wiring",
    "Server connections",
];

impl WizardScreen {
    pub fn handle_key(&mut self, code: KeyCode) {
        match self.section {
            Section::Menu => self.menu_key(code),
            Section::DbHost => self.dbhost_key(code),
            Section::Expose | Section::Server => {
                if matches!(code, KeyCode::Esc | KeyCode::Char('q')) {
                    self.section = Section::Menu;
                }
            },
        }
    }

    fn menu_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Down | KeyCode::Char('j') => {
                if self.cursor + 1 < MENU.len() {
                    self.cursor += 1;
                }
            },
            KeyCode::Up | KeyCode::Char('k') => {
                self.cursor = self.cursor.saturating_sub(1);
            },
            KeyCode::Enter => match self.cursor {
                0 => {
                    self.section = Section::DbHost;
                    self.input.clear();
                },
                1 => self.section = Section::Expose,
                _ => self.section = Section::Server,
            },
            _ => {},
        }
    }

    fn dbhost_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Esc => self.section = Section::Menu,
            KeyCode::Backspace => {
                self.input.pop();
            },
            KeyCode::Char(c) => self.input.push(c),
            KeyCode::Enter => self.save_dbhost(),
            _ => {},
        }
    }

    fn save_dbhost(&mut self) {
        let mut updates = std::collections::HashMap::new();
        updates.insert("WORKER_DB_HOST".to_string(), self.input.clone());
        let path = env::repo_root().join(env::WORKER_ENV_FILE);
        let result = env::write_keys(&path, &updates)
            .map(|_| format!("saved WORKER_DB_HOST={}", self.input))
            .unwrap_or_else(|e| format!("write failed: {e}"));
        self.toast_msg = Some(result);
        self.section = Section::Menu;
        self.input.clear();
    }

    pub fn take_toast(&mut self) -> Option<String> {
        self.toast_msg.take()
    }

    pub fn render(&self, frame: &mut ratatui::Frame, app: &App) {
        let area = frame.size();
        let block = widgets::panel(" WIZARDS ", &app.theme);
        let lines: Vec<Line> = match self.section {
            Section::Menu => MENU
                .iter()
                .enumerate()
                .map(|(i, item)| {
                    let mark = if i == self.cursor { "▸ " } else { "  " };
                    Line::from(format!("{mark}{item}"))
                })
                .chain(std::iter::once(hint(app)))
                .collect(),
            Section::DbHost => vec![
                Line::from("default WORKER_DB_HOST for new workers"),
                Line::from(Span::styled(
                    format!("> {}", self.input),
                    Style::new().fg(app.theme.accent).add_modifier(Modifier::BOLD),
                )),
                hint(app),
            ],
            Section::Expose => expose_lines(),
            Section::Server => server_lines(),
        };
        frame.render_widget(Paragraph::new(lines).block(block), area);
    }
}

fn hint<'a>(app: &'a App) -> Line<'a> {
    Span::styled("[Esc] back", Style::new().fg(app.theme.accent)).into()
}

fn expose_lines<'a>() -> Vec<Line<'a>> {
    let map = env::parse(&env::repo_root().join(env::CORE_ENV_FILE));
    let port = map.get("POSTGRES_PORT_EXTERNAL").cloned().unwrap_or_default();
    vec![
        Line::from(format!("admin panel port: {port}")),
        Line::from("wiring runs via ./cms expose subcommand"),
    ]
}

fn server_lines<'a>() -> Vec<Line<'a>> {
    let map = env::parse(&env::repo_root().join(env::WORKER_ENV_FILE));
    let mut keys: Vec<_> = map.keys().filter(|k| k.starts_with("WORKER_DB_HOST_")).collect();
    keys.sort();
    if keys.is_empty() {
        return vec![Line::from("no per-worker DB overrides")];
    }
    keys.iter()
        .map(|k| Line::from(format!("{k} = {}", map[*k])))
        .collect()
}
