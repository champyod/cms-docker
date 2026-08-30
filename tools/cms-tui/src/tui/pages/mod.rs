pub mod actions;
pub mod customization;
pub mod dashboard;
pub mod maintenance;
pub mod security;

use crate::tui::app::{App, Route};
use ratatui::{layout::Rect, Frame};

pub fn render_content(f: &mut Frame, area: Rect, app: &App) {
    match app.current_route() {
        Route::Dashboard => dashboard::render(f, area, app),
        Route::Actions => actions::render(f, area, app),
        Route::Customization => customization::render(f, area, app),
        Route::Security => security::render(f, area, app),
        Route::Maintenance => maintenance::render(f, area, app),
    }
}
