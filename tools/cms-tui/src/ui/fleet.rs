//! Fleet manager: worker table + detail pane + edit forms.

use crossterm::event::KeyCode;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Row, Table};

use crate::app::App;
use crate::data::env;
use crate::data::workers::{self, WorkerRow};
use crate::ui::widgets;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditField {
    Host,
    Port,
    DbHost,
    DbPort,
}

impl EditField {
    fn key(self) -> &'static str {
        match self {
            Self::Host => "WORKER_HOST",
            Self::Port => "WORKER_PORT",
            Self::DbHost => "WORKER_DB_HOST",
            Self::DbPort => "WORKER_DB_PORT",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Port => "port",
            Self::DbHost => "DB host",
            Self::DbPort => "DB port",
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Host => Self::Port,
            Self::Port => Self::DbHost,
            Self::DbHost => Self::DbPort,
            Self::DbPort => Self::Host,
        }
    }
}

#[derive(Debug, Default)]
pub struct FleetScreen {
    pub cursor: usize,
    mode: Option<EditField>,
    input: String,
    toast_msg: Option<String>,
}

impl FleetScreen {
    pub fn take_toast(&mut self) -> Option<String> {
        self.toast_msg.take()
    }

    pub fn handle_key(&mut self, code: KeyCode) {
        if let Some(field) = self.mode {
            match code {
                KeyCode::Esc => self.mode = None,
                KeyCode::Tab => self.mode = Some(field.next()),
                KeyCode::Backspace => {
                    self.input.pop();
                },
                KeyCode::Char(c) => self.input.push(c),
                KeyCode::Enter => self.commit_edit(field),
                _ => {},
            }
            return;
        }
        let len = workers_blocking().len();
        match code {
            KeyCode::Down | KeyCode::Char('j') => {
                if self.cursor + 1 < len {
                    self.cursor += 1;
                }
            },
            KeyCode::Up | KeyCode::Char('k') => {
                self.cursor = self.cursor.saturating_sub(1);
            },
            KeyCode::Char('e') => {
                self.mode = Some(EditField::Host);
                self.input.clear();
            },
            _ => {},
        }
    }

    fn commit_edit(&mut self, field: EditField) {
        let shard = workers_blocking()
            .get(self.cursor)
            .map(|w| w.shard)
            .unwrap_or_default();
        let key = format!("{}_{}", field.key(), shard);
        let mut updates = std::collections::HashMap::new();
        updates.insert(key, self.input.clone());
        let path = env::repo_root().join(env::WORKER_ENV_FILE);
        self.toast_msg = Some(match env::write_keys(&path, &updates) {
            Ok(()) => format!("saved {} for shard {shard}", field.label()),
            Err(e) => format!("write failed: {e}"),
        });
        self.mode = None;
    }
}

fn workers_blocking() -> Vec<WorkerRow> {
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(workers::fleet())
    })
}

pub fn render(frame: &mut ratatui::Frame, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Percentage(60),
        Constraint::Percentage(40),
    ])
    .split(frame.size());
    render_table(frame, app, chunks[0]);
    render_detail(frame, app, chunks[1]);
}

fn render_table(frame: &mut ratatui::Frame, app: &App, area: Rect) {
    let rows = workers_blocking();
    let body: Vec<Row> = rows
        .iter()
        .enumerate()
        .map(|(i, w)| worker_row(w, i == app.fleet.cursor, &app.theme))
        .collect();
    let widths = [
        Constraint::Length(2),
        Constraint::Length(6),
        Constraint::Length(20),
        Constraint::Length(6),
        Constraint::Length(10),
    ];
    let header = Row::new(["", "shard", "host", "port", "state"])
        .style(Style::new().fg(app.theme.accent).add_modifier(Modifier::BOLD));
    let table = Table::new(body, widths)
        .header(header)
        .block(widgets::panel(" WORKER FLEET ", &app.theme));
    frame.render_widget(table, area);
}

fn worker_row<'a>(w: &'a WorkerRow, selected: bool, theme: &crate::style::Theme) -> Row<'a> {
    let (glyph, color) = widgets::dot_state(w.running, theme);
    let cursor = if selected { "▸" } else { " " };
    let mut style = Style::new().fg(theme.fg);
    if selected {
        style = style.add_modifier(Modifier::REVERSED);
    }
    Row::new(vec![
        Span::raw(cursor.to_string()),
        Span::raw(w.shard.to_string()),
        Span::raw(w.host.clone()),
        Span::raw(w.port.to_string()),
        Span::styled(glyph.to_string(), Style::new().fg(color)),
    ])
    .style(style)
}

fn render_detail(frame: &mut ratatui::Frame, app: &App, area: Rect) {
    let rows = workers_blocking();
    let Some(w) = rows.get(app.fleet.cursor) else {
        let empty = Paragraph::new("no worker registered")
            .block(widgets::panel(" DETAIL ", &app.theme));
        frame.render_widget(empty, area);
        return;
    };
    if let Some(field) = app.fleet.mode {
        render_edit_form(frame, app, area, field);
        return;
    }
    let db = db_settings_for(w.shard);
    let text = vec![
        Line::from(format!("shard: {}", w.shard)),
        Line::from(format!("host: {}", w.host)),
        Line::from(format!("port: {}", w.port)),
        Line::from(format!("DB host: {}", db.0.unwrap_or_default())),
        Line::from(format!("DB port: {}", db.1.unwrap_or_default())),
        Line::from(Span::styled(
            "[e] edit host/port/db · Tab dashboard",
            Style::new().fg(app.theme.accent),
        )),
    ];
    frame.render_widget(
        Paragraph::new(text).block(widgets::panel(" DETAIL ", &app.theme)),
        area,
    );
}

fn render_edit_form(
    frame: &mut ratatui::Frame,
    app: &App,
    area: Rect,
    field: EditField,
) {
    let text = vec![
        Line::from(format!(
            "editing {} — Enter commits, Tab cycles fields, Esc cancels",
            field.label()
        )),
        Line::from(Span::styled(
            format!("> {}", app.fleet.input),
            Style::new().fg(app.theme.accent).add_modifier(Modifier::BOLD),
        )),
    ];
    frame.render_widget(
        Paragraph::new(text).block(widgets::panel(" EDIT ", &app.theme)),
        area,
    );
}

fn db_settings_for(shard: u32) -> (Option<String>, Option<String>) {
    let map = env::parse(&env::repo_root().join(env::WORKER_ENV_FILE));
    (
        map.get(&format!("WORKER_DB_HOST_{shard}")).cloned(),
        map.get(&format!("WORKER_DB_PORT_{shard}")).cloned(),
    )
}
