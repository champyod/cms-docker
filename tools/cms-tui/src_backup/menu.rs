//! Feature launcher tab: every ./cms subcommand, run-and-return.

use crossterm::event::KeyCode;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::App;
use crate::ui::widgets;

pub const COMMANDS: [(&str, &str); 16] = [
    ("Status dashboard", "status"),
    ("Monitor services", "monitor"),
    ("Backup now", "backup"),
    ("Restore from backup", "restore"),
    ("Doctor diagnostics", "doctor"),
    ("Self test", "test"),
    ("Database tools", "db"),
    ("Create admin", "admin-create"),
    ("Switch contest", "contest"),
    ("Pull upstream", "pull"),
    ("Deploy workers", "deploy"),
    ("Stop services", "stop"),
    ("Clean artifacts", "clean"),
    ("Tailscale setup", "tailscale"),
    ("Funnel exposure", "funnel"),
    ("Update ALL server (full)", "update-server"),
];

#[derive(Default)]
pub struct MenuScreen {
    pub cursor: usize,
    cmd_msg: Option<String>,
}

impl MenuScreen {
    pub fn handle_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Down | KeyCode::Char('j') => {
                if self.cursor + 1 < COMMANDS.len() {
                    self.cursor += 1;
                }
            },
            KeyCode::Up | KeyCode::Char('k') => {
                self.cursor = self.cursor.saturating_sub(1);
            },
            KeyCode::Enter => {
                let (_, arg) = COMMANDS[self.cursor];
                self.cmd_msg = Some(arg.to_string());
            },
            _ => {},
        }
    }

    pub fn take_cmd(&mut self) -> Option<String> {
        self.cmd_msg.take()
    }

    pub fn render(&self, frame: &mut ratatui::Frame, app: &App) {
        let lines: Vec<Line> = COMMANDS
            .iter()
            .enumerate()
            .map(|(i, (label, _))| {
                let mark = if i == self.cursor { "▸ " } else { "  " };
                let mut style = Style::new().fg(app.theme.fg);
                if i == self.cursor {
                    style = style.add_modifier(Modifier::REVERSED);
                }
                Line::from(Span::styled(format!("{mark}{label}"), style))
            })
            .chain(std::iter::once(widgets::dim_line(
                "↑↓ choose · Enter runs ./cms <cmd>, returns here",
                &app.theme,
            )))
            .collect();
        frame.render_widget(
            Paragraph::new(lines).block(widgets::panel(" FEATURES ", &app.theme)),
            frame.size(),
        );
    }
}
