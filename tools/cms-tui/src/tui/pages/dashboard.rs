use crate::tui::app::App;
use crate::tui::pages::render_env_list;
use ratatui::{layout::Rect, Frame};

pub fn render(f: &mut Frame, area: Rect, _app: &App) {
    render_env_list(f, area, "Dashboard — Infrastructure Overview");
}
