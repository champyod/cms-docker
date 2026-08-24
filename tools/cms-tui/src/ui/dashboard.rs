//! Dashboard 5-panel grid.
pub fn render(frame: &mut ratatui::Frame, app: &crate::app::App) {
    let area = frame.size();
    let block = ratatui::widgets::Block::default()
        .title(" CMS ")
        .title_style(ratatui::style::Style::new().fg(app.theme.accent))
        .style(
            ratatui::style::Style::new()
                .fg(app.theme.fg)
                .bg(app.theme.bg),
        )
        .borders(ratatui::widgets::Borders::ALL);
    frame.render_widget(block, area);
}
