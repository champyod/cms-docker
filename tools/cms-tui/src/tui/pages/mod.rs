pub mod backup;
pub mod bootstrap;
pub mod config;
pub mod dashboard;
pub mod database;
pub mod ingress;
pub mod page;
pub mod stacks;
pub mod system;
pub mod worker;

use crate::tui::app::{App, Route};
use ratatui::{layout::Rect, Frame};

pub fn render_content(f: &mut Frame, area: Rect, app: &App) {
    match app.current_route() {
        Route::Dashboard => dashboard::render(f, area, app),
        Route::Stacks => stacks::render(f, area, app),
        Route::Database => database::render(f, area, app),
        Route::Worker => worker::render(f, area, app),
        Route::Ingress => ingress::render(f, area, app),
        Route::Config => config::render(f, area, app),
        Route::Backup => backup::render(f, area, app),
        Route::System => system::render(f, area, app),
        Route::Bootstrap => bootstrap::render(f, area, app),
    }
}
