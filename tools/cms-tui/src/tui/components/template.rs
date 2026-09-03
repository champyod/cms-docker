use crate::tui::app::{App, WorkingPopup};
use crate::tui::pages;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

/// Shared chrome (header, breadcrumbs, footer, popup) with a content seam into `pages::render_content`.
pub fn render(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(4),
        ])
        .split(f.size());

    draw_header(f, chunks[0]);
    draw_breadcrumbs(f, chunks[1], app);
    pages::render_content(f, chunks[2], app);
    draw_footer(f, chunks[3]);

    if app.should_show_working_popup() {
        draw_popup(f, chunks[2], app);
    }
}

fn draw_header(f: &mut Frame, area: Rect) {
    let header = Paragraph::new(" CMS-TUI — Contest Management System ")
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
    f.render_widget(header, area);
}

fn draw_breadcrumbs(f: &mut Frame, area: Rect, app: &App) {
    let trail = app
        .route_stack()
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" > ");
    let crumb = Paragraph::new(format!(" {trail} "))
        .style(Style::default().fg(Color::Cyan))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        );
    f.render_widget(crumb, area);
}

fn draw_footer(f: &mut Frame, area: Rect) {
    let footer_text = " [q] Quit   [Esc] Back   [1] Dashboard   [2] Stacks   [3] Database   [4] Worker   [5] Ingress   [6] Config   [7] Backup   [8] System   [9] Bootstrap ";
    let footer = Paragraph::new(footer_text)
        .style(Style::default().fg(Color::DarkGray))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .wrap(Wrap { trim: true });
    f.render_widget(footer, area);
}

fn draw_popup(f: &mut Frame, area: Rect, app: &App) {
    let popup_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0), Constraint::Length(5)])
        .split(area);
    let msg = match app.working_message {
        WorkingPopup::Blinking => "[ Working... ]",
        WorkingPopup::TtyDropped => "[ Working... (check TTY for sudo/output) ]",
    };
    let popup = Paragraph::new(msg)
        .style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD | Modifier::SLOW_BLINK),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Please Wait ")
                .style(Style::default().fg(Color::Yellow)),
        );
    f.render_widget(popup, popup_chunks[1]);
}
