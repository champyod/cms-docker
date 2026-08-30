use crate::tui::app::App;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let count = app.state.configs.len();
    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" Customization — {count} config files "))
        .style(Style::default().fg(Color::Cyan));

    if app.state.configs.is_empty() {
        let paragraph = Paragraph::new("(no config files)")
            .style(Style::default().add_modifier(Modifier::DIM))
            .block(block);
        f.render_widget(paragraph, area);
        return;
    }

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        " Managed config files — name · path · syntax (read-only)",
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::DIM),
    )));
    lines.push(Line::from(""));

    for config in &app.state.configs {
        let name = Span::styled(
            format!(" {} ", config.name),
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        );
        let path = Span::styled(
            format!(" {} ", config.path),
            Style::default().fg(Color::Yellow),
        );
        let syntax = Span::styled(
            format!(" [{}] ", config.syntax),
            Style::default().fg(Color::DarkGray),
        );
        let id = Span::styled(
            format!(" ({}) ", config.id),
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::DIM),
        );
        lines.push(Line::from(vec![name, path, syntax, id]));
    }

    let paragraph = Paragraph::new(lines).block(block);
    f.render_widget(paragraph, area);
}
