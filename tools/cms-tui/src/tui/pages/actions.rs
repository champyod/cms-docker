use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let count = app.state.tasks.len();
    let title = format!(" Actions & Deployment — {count} tasks ");
    app.actions_menu.render(f, area, &title);
}
