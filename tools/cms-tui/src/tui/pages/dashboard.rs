use crate::core::model::ServiceStatus;
use crate::tui::app::App;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

fn status_color(status: &ServiceStatus) -> Color {
    match status {
        ServiceStatus::Up => Color::Green,
        ServiceStatus::Down => Color::Red,
        ServiceStatus::Running => Color::Cyan,
        ServiceStatus::Paused => Color::Yellow,
        ServiceStatus::Unknown => Color::DarkGray,
    }
}

fn status_label(status: &ServiceStatus) -> &'static str {
    match status {
        ServiceStatus::Up => "Up",
        ServiceStatus::Down => "Down",
        ServiceStatus::Running => "Running",
        ServiceStatus::Paused => "Paused",
        ServiceStatus::Unknown => "Unknown",
    }
}

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let count = app.state.services.len();
    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" Infrastructure Overview — {} services ", count))
        .style(Style::default().fg(Color::Cyan));

    if app.state.services.is_empty() {
        let paragraph = Paragraph::new("(no services)")
            .style(Style::default().add_modifier(Modifier::DIM))
            .block(block);
        f.render_widget(paragraph, area);
        return;
    }

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        " Services grouped by environment — name · version · status",
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::DIM),
    )));
    lines.push(Line::from(""));

    for service in &app.state.services {
        let status = Span::styled(
            format!(" [{}] ", status_label(&service.status)),
            Style::default()
                .fg(status_color(&service.status))
                .add_modifier(Modifier::BOLD),
        );
        let env = Span::styled(
            format!(" {} ", service.env),
            Style::default().fg(Color::Yellow),
        );
        let name = Span::styled(
            format!(" {} ", service.name),
            Style::default().fg(Color::White),
        );
        let version = Span::styled(
            format!(" v{} ", service.version),
            Style::default().fg(Color::DarkGray),
        );
        let id = Span::styled(
            format!(" ({}) ", service.id),
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::DIM),
        );
        lines.push(Line::from(vec![env, name, version, status, id]));
    }

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}
