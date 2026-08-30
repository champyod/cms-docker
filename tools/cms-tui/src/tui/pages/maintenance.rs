use crate::core::model::TaskType;
use crate::tui::app::App;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

const STATIC_MAINTENANCE: &[(&str, &str)] = &[
    ("make backup", "run backup now (cms-monitor)"),
    (
        "make backup drill",
        "backup + test restore of latest archive",
    ),
    (
        "make backup offsite [--apply]",
        "sync backups to offsite node",
    ),
    ("restore <archive>", "__restore.sh <archive>"),
    (
        "make update / update --all",
        "config wizard / full server update",
    ),
    (
        "make update-server / cms update-server",
        "__update-server.sh (git+img+db+verify)",
    ),
    (
        "make db-reset / db-clean / db-sync",
        "reset / clean / sync database",
    ),
    ("make preflight / cms doctor", "__preflight.sh — env checks"),
    (
        "make smoke-test / cms test",
        "__smoke-test.sh — deployment verify",
    ),
    (
        "make pull [stack]",
        "pull images for offline-tolerant deploy",
    ),
];

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Maintenance — Backups & Operations ")
        .style(Style::default().fg(Color::Cyan));

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        " Maintenance command surface — reference for available operations ",
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::DIM),
    )));
    lines.push(Line::from(""));

    let maintenance_tasks: Vec<_> = app
        .state
        .tasks
        .iter()
        .filter(|task| {
            matches!(
                task.category,
                TaskType::Backup | TaskType::DBOperation | TaskType::Audit
            )
        })
        .collect();

    if maintenance_tasks.is_empty() {
        lines.push(Line::from(Span::styled(
            " No seeded maintenance tasks matched filter (unexpected)",
            Style::default().fg(Color::Yellow),
        )));
    } else {
        lines.push(Line::from(Span::styled(
            " Tasks from AppState (Backup / DBOperation / Audit):",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        )));
        for task in maintenance_tasks {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("  • {} ", task.name),
                    Style::default().fg(Color::White),
                ),
                Span::styled(
                    format!("({:?}) ", task.category),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(
                    format!("— {} ", task.command),
                    Style::default().fg(Color::Cyan),
                ),
            ]));
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::from(Span::styled(
        " Full maintenance surface (Makefile / cli/mod.rs):",
        Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    )));
    for (command, description) in STATIC_MAINTENANCE {
        lines.push(Line::from(vec![
            Span::styled(format!("  • {command}"), Style::default().fg(Color::Cyan)),
            Span::styled(
                format!("  — {description}"),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}
