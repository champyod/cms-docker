use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " Database — Init/Reset/Clean/Sync ";
    app.database_menu.render(f, area, title);
}
