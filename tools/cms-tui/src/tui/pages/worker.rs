use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " Worker — Fleet/Server/Connect/Cgroup ";
    app.worker_menu.render(f, area, title);
}
