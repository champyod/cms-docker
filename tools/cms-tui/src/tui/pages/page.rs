use crate::tui::app::App;
use crate::tui::components::action_menu::ActionMenu;
use ratatui::{
    layout::Rect,
    Frame,
};

pub fn render_page(
    f: &mut Frame,
    area: Rect,
    _app: &App,
    menu: &ActionMenu,
    title: &str,
    description: &str,
    help_text: &str,
) {
    let chunks = ratatui::layout::Layout::default()
        .direction(ratatui::layout::Direction::Vertical)
        .constraints([
            ratatui::layout::Constraint::Length(3),
            ratatui::layout::Constraint::Min(0),
            ratatui::layout::Constraint::Length(3),
        ])
        .split(area);

    let title_block = ratatui::widgets::Paragraph::new(format!(" {title} "))
        .style(
            ratatui::style::Style::default()
                .fg(ratatui::style::Color::Cyan)
                .add_modifier(ratatui::style::Modifier::BOLD),
        )
        .block(
            ratatui::widgets::Block::default()
                .borders(ratatui::widgets::Borders::ALL)
                .style(ratatui::style::Style::default().fg(ratatui::style::Color::Cyan)),
        );
    f.render_widget(title_block, chunks[0]);

    let menu_chunks = ratatui::layout::Layout::default()
        .direction(ratatui::layout::Direction::Vertical)
        .constraints([
            ratatui::layout::Constraint::Length(1),
            ratatui::layout::Constraint::Min(0),
        ])
        .split(chunks[1]);

    let desc = ratatui::widgets::Paragraph::new(description)
        .style(ratatui::style::Style::default().fg(ratatui::style::Color::DarkGray))
        .block(ratatui::widgets::Block::default().borders(ratatui::widgets::Borders::NONE));
    f.render_widget(desc, menu_chunks[0]);

    menu.render(f, menu_chunks[1], "");

    let help = ratatui::widgets::Paragraph::new(help_text)
        .style(ratatui::style::Style::default().fg(ratatui::style::Color::DarkGray))
        .block(
            ratatui::widgets::Block::default()
                .borders(ratatui::widgets::Borders::ALL)
                .border_style(ratatui::style::Style::default().fg(ratatui::style::Color::DarkGray)),
        );
    f.render_widget(help, chunks[2]);
}
