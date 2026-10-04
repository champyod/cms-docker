use crate::tui::app::App;
use crate::tui::pages::page;
use ratatui::{layout::Rect, Frame};

/// Ingress page — exposure chooser plus the domain/Tailscale/Funnel actions.
///
/// WHY the two live on one page: the actions here run certbot and `tailscale serve`,
/// while the exposure chooser is a fast local edit, and both answer the same question —
/// how is this box reachable. The chooser is reached with `e`.
pub fn render(f: &mut Frame, area: Rect, app: &App) {
    page::render_page(
        f,
        area,
        app,
        &app.ingress_menu,
        "Ingress — Tailscale/Funnel/Domain",
        "Ingress: Tailscale (setup/status/remove), Funnel \
         (setup/passwd/remove/status), Domain \
         (setup/status/renew/preflight). Use ↑/↓ or j/k, Enter to execute. \
         Press 'e' for the per-UI exposure chooser.",
        "[↑/↓/j/k] Navigate   [Enter] Execute   [e] Exposure chooser   \
         [1-9] Switch page   [Esc] Back   [q] Quit",
    );
}