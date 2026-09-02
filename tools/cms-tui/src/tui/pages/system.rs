use crate::tui::app::App;
use crate::tui::pages::page;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    page::render_page(
        f,
        area,
        app,
        &app.system_menu,
        "System — Doctor/Smoke Test/Update Server",
        "System operations: run preflight checks, smoke test, or full server update. Use ↑/↓ or j/k to navigate, Enter to execute.",
        "[↑/↓/j/k] Navigate   [Enter] Execute   [1-9] Switch page   [Esc] Back   [q] Quit",
    );
}
