use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " Config — Sync/Edit/Show + Secrets ";
    app.config_menu.render(f, area, title);
}
