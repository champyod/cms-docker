use crate::tui::app::App;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let title = " Stacks — Deploy/Stop/Clean/Pull per Stack ";
    app.stacks_menu.render(f, area, title);
}
