use crate::tui::app::App;
use crate::tui::pages::page;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    page::render_page(
        f,
        area,
        app,
        &app.ingress_menu,
        "Ingress — Tailscale/Funnel/Domain",
        "Ingress: Tailscale (setup/status/remove), Funnel \
         (setup/passwd/remove/status), Domain \
         (setup/cert/proxy/status/renew/preflight/check-expiry/revoke). \
         Use ↑/↓ or j/k, Enter to execute. Press d for the domain flag form.",
        "[↑/↓/j/k] Navigate   [Enter] Execute   [d] Domain form   [1-9] Switch page   [Esc] Back   [q] Quit",
    );
}
