use crate::tui::app::App;
use crate::tui::pages::page;
use ratatui::{layout::Rect, Frame};

/// Ingress page — exposure chooser plus the domain/Tailscale/Funnel actions.
///
/// WHY the two live on one page: the actions here run certbot and `tailscale serve`,
/// while the exposure chooser is a fast local edit, and both answer the same question —
/// how is this box reachable. The chooser is reached with `e`.
///
/// WHY "Domain Setup" here is the fixed default rather than the form: the form is
/// reachable with `d` and is where every other flag lives, so this row stays as the
/// one-keystroke dry run for the common case and keeps the same argv it always had.
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
         Press 'e' for the per-UI exposure chooser, 'd' for the domain setup form.",
        "[↑/↓/j/k] Navigate   [Enter] Execute   [e] Exposure chooser   \
         [d] Domain form   [1-9] Switch page   [Esc] Back   [q] Quit",
    );
}
