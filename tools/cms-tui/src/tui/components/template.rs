use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use crate::tui::app::{App, WorkingPopup};

pub fn render(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(3),
        ].as_ref())
        .split(f.size());

    let breadcrumbs = app.route_stack.iter()
        .map(|r| r.to_string())
        .collect::<Vec<String>>()
        .join(" > ");
    
    let header_text = format!(" 🏠 {} ", breadcrumbs);
    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .block(Block::default().borders(Borders::ALL).title(" CMS-TUI "));
    f.render_widget(header, chunks[0]);

    let content = Paragraph::new(format!("\n  Currently viewing: {}\n\n  (Main content injected here)", app.current_route()))
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(content, chunks[1]);

    let footer_text = " [Esc/q] Go Back/Quit   [1] Dashboard   [2] Actions   [3] Customization ";
    let footer = Paragraph::new(footer_text)
        .style(Style::default().fg(Color::DarkGray))
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(footer, chunks[2]);
    
    // Overlay: Working Popup
    if app.show_working_popup {
        let popup_chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(0), Constraint::Length(5)].as_ref())
            .split(chunks[1]);
        let working_area = popup_chunks[1];
        
        let msg = match app.working_message {
            WorkingPopup::Blinking => "[ Working... ]",
            _ => "[ Working... (check TTY for sudo/output) ]",
        };
        let popup = Paragraph::new(msg)
            .style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD | Modifier::SLOW_BLINK))
            .block(Block::default().borders(Borders::ALL).title(" Please Wait "));
        f.render_widget(popup, working_area);
    }
}
