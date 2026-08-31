use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " System — Doctor/Test/Update-Server ";
    app.system_menu.render(f, area, title);
}
