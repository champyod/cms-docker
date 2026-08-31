use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " Bootstrap — Setup/Update/Fix/Admin-Create ";
    app.bootstrap_menu.render(f, area, title);
}
