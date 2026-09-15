use crate::tui::app::App;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

pub fn render(f: &mut Frame, area: Rect, _app: &App) {
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

    // Dashboard no longer fabricates per-service status. Live probing
    // lives in scripts/__status.sh and is surfaced via System > Live
    // Status (./cms status) so this view stays honest.
    let lines = vec![
        Line::from(Span::styled(
            " Navigate with [1-9] — use System > Live Status for",
            Style::default().fg(Color::White),
        )),
        Line::from(Span::styled(
            " live service state (./cms status → scripts/__status.sh).",
            Style::default().fg(Color::White),
        )),
        Line::from(""),
        Line::from(Span::styled(
            " Stacks control deploy/stop/clean/pull; other pages",
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::DIM),
        )),
        Line::from(Span::styled(
            " expose the remaining catalog commands.",
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::DIM),
        )),
    ];
    let paragraph = Paragraph::new(lines).block(
        Block::default()
            .borders(Borders::ALL)
            .title(" overview ")
            .style(Style::default().fg(Color::Cyan)),
    );
    f.render_widget(paragraph, chunks[1]);

    let help = Paragraph::new("[1-9] Switch page   [q] Quit   [Esc] Back")
        .style(Style::default().fg(Color::DarkGray))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        );
    f.render_widget(help, chunks[2]);
}
