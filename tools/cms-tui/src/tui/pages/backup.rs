use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " Backup — Run/Drill/Offsite/Restore ";
    app.backup_menu.render(f, area, title);
}
