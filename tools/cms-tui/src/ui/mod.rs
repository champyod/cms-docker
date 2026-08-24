pub mod dashboard;
pub mod fleet;
pub mod modal;
pub mod widgets;

use crate::app::App;

/// Render the active tab.
pub fn render(frame: &mut ratatui::Frame, app: &App) {
    match app.tab {
        crate::app::Tab::Dashboard => dashboard::render(frame, app),
        crate::app::Tab::Fleet => fleet::render(frame, app),
        crate::app::Tab::Wizards => app.wizard.render(frame, app),
        crate::app::Tab::Menu => app.menu.render(frame, app),
    }
    if app.help_open {
        modal::render_help(frame, &app.theme);
    }
}
