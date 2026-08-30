use crate::core::model::TaskType;
use crate::tui::app::App;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

const SECURITY_COMMANDS: &[(&str, &str)] = &[
    ("secrets rotate --apply", "rotate flagged secrets in place"),
    ("secrets audit", "report insecure/weak secrets"),
    (
        "secrets generate [--out FILE]",
        "print/save replacement secrets",
    ),
    ("tailscale setup / status / remove", "tailnet HTTPS front"),
    (
        "funnel setup / passwd / remove / status",
        "public ts.net + basic auth",
    ),
    (
        "domain setup / status / renew / preflight",
        "domain HTTPS lifecycle",
    ),
];

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Security — Posture & Secrets ")
        .style(Style::default().fg(Color::Cyan));

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        " Security command surface — reference for available operations ",
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::DIM),
    )));
    lines.push(Line::from(""));

    let security_tasks: Vec<_> = app
        .state
        .tasks
        .iter()
        .filter(|task| task.category == TaskType::Security)
        .collect();

    if security_tasks.is_empty() {
        lines.push(Line::from(Span::styled(
            " No seeded tasks with category == Security (seed covers DockerControl/Backup/DBOperation)",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::DIM),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            " Security tasks from AppState:",
            Style::default().fg(Color::White),
        )));
        for task in security_tasks {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("  • {} ", task.name),
                    Style::default().fg(Color::White),
                ),
                Span::styled(
                    format!(" — {} ", task.command),
                    Style::default().fg(Color::DarkGray),
                ),
            ]));
        }
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " Curated security surface (from cli/mod.rs taxonomy):",
        Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    )));
    for (command, description) in SECURITY_COMMANDS {
        lines.push(Line::from(vec![
            Span::styled(format!("  • {command}"), Style::default().fg(Color::Cyan)),
            Span::styled(
                format!("  — {description}"),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        " Notes: secrets masked at input, validate_value guards ports/hosts; Docker socket = root.",
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::DIM),
    )));

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}
