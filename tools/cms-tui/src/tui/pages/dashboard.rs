use crate::core::model::ServiceStatus;
use crate::tui::app::App;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

const fn status_color(status: &ServiceStatus) -> Color {
    match status {
        ServiceStatus::Up => Color::Green,
        ServiceStatus::Down => Color::Red,
        ServiceStatus::Running => Color::Cyan,
        ServiceStatus::Paused => Color::Yellow,
        ServiceStatus::Unknown => Color::DarkGray,
    }
}

const fn status_label(status: &ServiceStatus) -> &'static str {
    match status {
        ServiceStatus::Up => "Up",
        ServiceStatus::Down => "Down",
        ServiceStatus::Running => "Running",
        ServiceStatus::Paused => "Paused",
        ServiceStatus::Unknown => "Unknown",
    }
}

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(3),
        ])
        .split(area);

    let title = Paragraph::new(" Infrastructure Overview ")
        .style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .style(Style::default().fg(Color::Cyan)),
        );
    f.render_widget(title, chunks[0]);

    let count = app.state.services.len();
    if app.state.services.is_empty() {
        let paragraph = Paragraph::new("(no services — run 'make core' to deploy)")
            .style(Style::default().add_modifier(Modifier::DIM))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .style(Style::default().fg(Color::DarkGray)),
            );
        f.render_widget(paragraph, chunks[1]);
    } else {
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

        let paragraph = Paragraph::new(lines).block(
            Block::default()
                .borders(Borders::ALL)
                .title(format!(" {count} services "))
                .style(Style::default().fg(Color::Cyan)),
        );
        f.render_widget(paragraph, chunks[1]);
    }

    let help = Paragraph::new("[1-9] Switch page   [q] Quit   [r] Refresh   [Esc] Back")
        .style(Style::default().fg(Color::DarkGray))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        );
    f.render_widget(help, chunks[2]);
}
