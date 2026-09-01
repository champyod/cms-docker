use crate::tui::app::App;
use crate::tui::pages::page;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    page::render_page(
        f,
        area,
        app,
        &app.config_menu,
        "Config — Sync/Edit/Show/Secrets",
        "Manage configuration: sync from config.toml, edit, show, or manage secrets. Use ↑/↓ or j/k to navigate, Enter to execute.",
        "[↑/↓/j/k] Navigate   [Enter] Execute   [1-9] Switch page   [Esc] Back   [q] Quit",
    );
}
