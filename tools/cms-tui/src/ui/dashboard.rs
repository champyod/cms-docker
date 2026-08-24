//! Dashboard 5-panel grid: WORKERS/SERVICES/DATABASE over BACKUPS|UPDATES.

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem, Paragraph};

use crate::app::App;
use crate::data::docker;
use crate::data::workers::WorkerRow;
use crate::style::Theme;

use super::widgets;

const CORE_SERVICES: [&str; 8] = [
    "database",
    "log-service",
    "scoring",
    "evaluation",
    "proxy",
    "checker",
    "admin-panel-next",
    "ranking-web-server",
];

pub fn render(frame: &mut ratatui::Frame, app: &App) {
    let area = frame.size();
    let chunks = Layout::vertical([Constraint::Min(0), Constraint::Length(1)]).split(area);
    if chunks[0].width >= 80 {
        render_wide(frame, app, chunks[0]);
    } else {
        render_narrow(frame, app, chunks[0]);
    }
    footer(frame, app, chunks[1]);
}

fn render_wide(frame: &mut ratatui::Frame, app: &App, area: Rect) {
    let rows = Layout::vertical([
        Constraint::Percentage(62),
        Constraint::Percentage(38),
    ])
    .split(area);
    let top = Layout::horizontal([
        Constraint::Ratio(1, 3),
        Constraint::Ratio(1, 3),
        Constraint::Ratio(1, 3),
    ])
    .split(rows[0]);
    let bottom = Layout::horizontal([
        Constraint::Percentage(50),
        Constraint::Percentage(50),
    ])
    .split(rows[1]);
    render_list(frame, app, top[0], "WORKERS", worker_lines(app));
    render_list(frame, app, top[1], "SERVICES", service_lines(app));
    render_list(frame, app, top[2], "DATABASE", database_lines(app));
    render_list(frame, app, bottom[0], "BACKUPS", backup_lines(app));
    render_list(frame, app, bottom[1], "UPDATES", update_lines(app));
}

fn render_narrow(frame: &mut ratatui::Frame, app: &App, area: Rect) {
    let cells = Layout::vertical([
        Constraint::Ratio(1, 5),
        Constraint::Ratio(1, 5),
        Constraint::Ratio(1, 5),
        Constraint::Ratio(1, 5),
        Constraint::Ratio(1, 5),
    ])
    .split(area);
    render_list(frame, app, cells[0], "WORKERS", worker_lines(app));
    render_list(frame, app, cells[1], "SERVICES", service_lines(app));
    render_list(frame, app, cells[2], "DATABASE", database_lines(app));
    render_list(frame, app, cells[3], "BACKUPS", backup_lines(app));
    render_list(frame, app, cells[4], "UPDATES", update_lines(app));
}

fn render_list(
    frame: &mut ratatui::Frame,
    app: &App,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
) {
    let items: Vec<ListItem> = if app.snapshot.has_data() {
        lines.into_iter().map(ListItem::new).collect()
    } else {
        vec![ListItem::new(widgets::dim_line("collecting…", &app.theme))]
    };
    frame.render_widget(
        List::new(items).block(widgets::panel(title, &app.theme)),
        area,
    );
}

fn worker_lines(app: &App) -> Vec<Line<'static>> {
    if app.snapshot.workers.is_empty() {
        return vec![widgets::dim_line("(no workers registered)", &app.theme)];
    }
    app.snapshot
        .workers
        .iter()
        .map(|worker| worker_item(worker, &app.theme))
        .collect()
}

fn worker_item(worker: &WorkerRow, theme: &Theme) -> Line<'static> {
    let state = if worker.running {
        docker::ServiceState::Running
    } else {
        docker::ServiceState::Stopped
    };
    let (glyph, color) = widgets::dot(state, theme);
    Line::from(vec![
        Span::raw(format!("{} ", worker.shard)),
        Span::raw(format!("{}:{} ", worker.host, worker.port)),
        Span::styled(glyph.to_string(), Style::new().fg(color)),
        Span::styled(format!(" {}", state.label()), Style::new().fg(color)),
    ])
}

fn service_lines(app: &App) -> Vec<Line<'static>> {
    if let Some(error) = &app.snapshot.services_error {
        return vec![widgets::dim_line(&format!("docker: {error}"), &app.theme)];
    }
    CORE_SERVICES
        .iter()
        .map(|service| widgets::status_line(service, docker::lookup(&app.snapshot.services, service), &app.theme))
        .collect()
}

fn database_lines(app: &App) -> Vec<Line<'static>> {
    let db = app.snapshot.db;
    let (healthy_label, health_color) = if db.healthy {
        ("healthy", app.theme.ok)
    } else {
        ("unhealthy", app.theme.err)
    };
    let value = |count: i64| {
        if db.healthy {
            count.to_string()
        } else {
            "-".to_string()
        }
    };
    vec![
        Line::from(Span::styled(format!("● {healthy_label}"), Style::new().fg(health_color))),
        Line::from(format!("contests: {}", value(db.contests))),
        Line::from(format!("users: {}", value(db.users))),
        Line::from(format!("teams: {}", value(db.teams))),
    ]
}

fn backup_lines(app: &App) -> Vec<Line<'static>> {
    let Some(backup) = &app.snapshot.backup else {
        return vec![
            widgets::dim_line("latest   (none yet)", &app.theme),
            widgets::dim_line("hint     run: ./cms backup", &app.theme),
        ];
    };
    let mut lines = vec![
        Line::from(format!("latest   {}", backup.filename)),
        Line::from(format!("age      {} ago", backup.age_human())),
        Line::from(format!("size     {}", backup.size_human())),
    ];
    if let Some(drill) = &app.snapshot.drill {
        let color = if drill == "PASS" {
            app.theme.ok
        } else {
            app.theme.err
        };
        lines.push(Line::from(Span::styled(
            format!("drill    {drill}"),
            Style::new().fg(color),
        )));
    }
    lines
}

fn update_lines(app: &App) -> Vec<Line<'static>> {
    match &app.snapshot.git {
        None => vec![widgets::dim_line("branch   unknown", &app.theme)],
        Some(git) => vec![
            Line::from(format!("branch   {}", git.branch)),
            Line::from(format!(
                "local    {} (ahead {})",
                git.head_short, git.ahead
            )),
            Line::from(format!(
                "upstream {} (behind {})",
                git.upstream_short, git.behind
            )),
        ],
    }
}

fn footer(frame: &mut ratatui::Frame, app: &App, area: Rect) {
    let keys = "[Tab]panels [r]efresh [w]orkers [?]help [q]uit";
    let clock = if app.snapshot.has_data() {
        format!(" · updated {}", app.snapshot.updated_clock)
    } else {
        String::new()
    };
    let line = Line::from(vec![
        Span::styled(keys.to_string(), Style::new().fg(app.theme.dim)),
        Span::styled(clock, Style::new().fg(app.theme.dim)),
    ]);
    frame.render_widget(Paragraph::new(line), area);
}
