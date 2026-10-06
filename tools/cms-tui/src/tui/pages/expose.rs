//! Exposure chooser — pick how each UI is published, and see which modes are blocked.
//!
//! WHY a chooser rather than four env keys: the failure this prevents is publishing a
//! service on `0.0.0.0` when the operator meant loopback, which on a school LAN makes
//! an admin panel reachable by every host on the network with no warning at all. The
//! modes that conflict with the domain nginx are shown greyed with the reason rather
//! than hidden, so the choice stays visible and explained instead of disappearing.

use crate::core::expose::{
    domain_stack_is_active, mode_allowed, mode_conflicts_with_domain, Mode, UiSpec,
};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

/// The exposure chooser state.
pub struct ExposureView {
    /// Index into [`UiSpec::ALL`].
    ui: usize,
    /// Index into [`Mode::ALL`].
    mode: usize,
    /// Whether the domain nginx currently owns :80/:443.
    domain_active: bool,
    /// Whether a tailnet is joined.
    has_tailnet: bool,
    /// The Tailnet address, when one is known.
    tailscale_ip: Option<String>,
    /// Why the highlighted mode is unavailable, when it is.
    notice: Option<String>,
    /// Whether a `tailscale serve` entry currently exists for the selected UI.
    serve_active: bool,
}

impl ExposureView {
    /// Creates a view over the current host state.
    #[must_use]
    pub const fn new(domain_active: bool, has_tailnet: bool, tailscale_ip: Option<String>) -> Self {
        Self {
            ui: 0,
            mode: 0,
            domain_active,
            has_tailnet,
            tailscale_ip,
            notice: None,
            serve_active: false,
        }
    }

    /// The UI currently being configured.
    #[must_use]
    pub const fn ui(&self) -> &'static UiSpec {
        UiSpec::at(self.ui)
    }

    /// The highlighted mode.
    #[must_use]
    pub const fn mode(&self) -> Mode {
        Mode::ALL[self.mode]
    }

    /// The Tailnet address, when one is known.
    #[must_use]
    pub fn tailscale_ip(&self) -> Option<&str> {
        self.tailscale_ip.as_deref()
    }

    /// Records the Tailnet address so `ts-http` previews and binds resolve.
    pub fn set_tailscale_ip(&mut self, ip: Option<String>) {
        self.has_tailnet = ip.is_some();
        self.tailscale_ip = ip;
        self.recompute_notice();
    }

    /// Moves the cursor onto a specific mode.
    ///
    /// WHY an out-of-range index is ignored rather than panicking: this is called from
    /// key handling and from a restored view, and a panic in a TUI on a keystroke is a
    /// far worse outcome than a cursor that stays put.
    pub fn set_mode(&mut self, mode: Mode) {
        if let Some(index) = Mode::ALL.iter().position(|candidate| *candidate == mode) {
            self.mode = index;
            self.recompute_notice();
        }
    }

    /// Records whether a `tailscale serve` entry exists for the current UI.
    ///
    /// WHY the view tracks this: `local` and `ts-https` share the `127.0.0.1` bind
    /// address, so the bind value on its own cannot tell the operator whether the
    /// tailnet entry still needs to be removed or added.
    pub const fn set_serve_active(&mut self, active: bool) {
        self.serve_active = active;
    }

    /// Whether a `tailscale serve` entry currently exists for this UI.
    #[must_use]
    pub const fn serve_active(&self) -> bool {
        self.serve_active
    }

    /// Why the highlighted mode is unavailable, if it is.
    #[must_use]
    pub fn notice(&self) -> Option<&str> {
        self.notice.as_deref()
    }

    /// Moves to the next UI, wrapping at the end.
    pub fn next_ui(&mut self) {
        self.ui = (self.ui + 1) % UiSpec::ALL.len();
        self.recompute_notice();
    }

    /// Moves to the previous UI, wrapping at the start.
    pub fn prev_ui(&mut self) {
        self.ui = (self.ui + UiSpec::ALL.len() - 1) % UiSpec::ALL.len();
        self.recompute_notice();
    }

    /// Moves to the next mode.
    ///
    /// WHY blocked modes are skipped rather than selectable: a mode that cannot be
    /// applied must not be reachable by Enter, because there is no write to make and
    /// no error to report at that point.
    pub fn next_mode(&mut self) {
        for step in 1..=Mode::ALL.len() {
            let candidate = (self.mode + step) % Mode::ALL.len();
            if self.is_selectable(candidate) {
                self.mode = candidate;
                self.recompute_notice();
                return;
            }
        }
    }

    /// Moves to the previous selectable mode.
    pub fn prev_mode(&mut self) {
        let count = Mode::ALL.len();
        for step in 1..=count {
            let candidate = (self.mode + count - step) % count;
            if self.is_selectable(candidate) {
                self.mode = candidate;
                self.recompute_notice();
                return;
            }
        }
    }

    /// Whether a mode may be applied right now.
    ///
    /// Blocked modes are greyed in the list and skipped by the cursor, so the operator
    /// sees them and the reason but cannot commit one.
    #[must_use]
    pub fn is_selectable(&self, mode_index: usize) -> bool {
        let mode = Mode::ALL[mode_index];
        self.block_reason(mode).is_none()
    }

    /// Why a mode is unavailable, or `None` when it is available.
    ///
    /// WHY the domain check comes first: it is the reason an operator will actually
    /// hit, and it is specific to this host's configuration rather than a missing
    /// tool.
    #[must_use]
    pub fn block_reason(&self, mode: Mode) -> Option<String> {
        if let Err(reason) = mode_allowed(self.ui(), mode, self.has_tailnet) {
            return Some(reason);
        }
        if self.domain_active && mode_conflicts_with_domain(mode) {
            return Some(
                "blocked in domain mode — nginx already publishes this on :80/:443; \
                 choose 'domain' to stay behind the proxy"
                    .to_string(),
            );
        }
        None
    }

    fn recompute_notice(&mut self) {
        self.notice = self.block_reason(self.mode());
    }

    /// A one-line preview of where the highlighted mode puts the UI.
    #[must_use]
    pub fn url_preview(&self) -> String {
        let spec = self.ui();
        let port = spec.default_port;
        match self.mode() {
            Mode::Local => "localhost only".to_string(),
            Mode::Public => format!("http://<host>:{port}"),
            Mode::TsHttp => self.tailscale_ip.as_deref().map_or_else(
                || format!("http://<tailscale-ip>:{port}"),
                |ip| format!("http://{ip}:{port}"),
            ),
            Mode::TsHttps => format!(
                "https://<node>.<tailnet>.ts.net:{}",
                spec.default_https_port
            ),
            Mode::Domain => "https://<your-domain>/ (via nginx :443)".to_string(),
        }
    }

    fn render_modes(&self, f: &mut Frame, area: Rect) {
        let spec = self.ui();
        let mut lines: Vec<Line> = Vec::new();

        for (index, mode) in Mode::ALL.iter().enumerate() {
            let blocked = self.block_reason(*mode);
            let is_highlighted = index == self.mode;

            let marker = if is_highlighted { '>' } else { ' ' };
            let check = if blocked.is_some() { 'x' } else { 'o' };

            // WHY a blocked row is dimmed and annotated rather than dropped: hiding it
            // makes the operator think the mode does not exist, while dimming shows
            // the trade-off that produced the block.
            let suffix = blocked
                .as_deref()
                .map_or_else(String::new, |reason| format!("  [blocked: {reason}]"));
            let base_style = if blocked.is_some() {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default().fg(Color::Gray)
            };

            let mut spans = vec![
                Span::styled(
                    format!("{marker} ({check}) "),
                    // WHY no BOLD: the loop below bolds every span of a highlighted row.
                    if is_highlighted {
                        Style::default().fg(Color::Cyan)
                    } else {
                        base_style
                    },
                ),
                Span::styled(format!("{mode:<9}"), base_style),
                Span::styled(suffix, Style::default().fg(Color::DarkGray)),
            ];

            if is_highlighted {
                for span in &mut spans {
                    span.style = span.style.add_modifier(Modifier::BOLD);
                }
            }
            lines.push(Line::from(spans));
        }

        let heading = Line::from(Span::styled(
            format!("  {} → {}", spec.name, self.url_preview()),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
        lines.insert(0, heading);
        lines.insert(1, Line::from(Span::raw("")));

        let block = Block::default()
            .borders(Borders::ALL)
            .title(format!(" {} — wiring ", spec.name));
        f.render_widget(Paragraph::new(lines).block(block), area);
    }

    fn render_footer(&self, f: &mut Frame, area: Rect) {
        let domain_note = if self.domain_active {
            "domain nginx ACTIVE on :80/:443 — public and ts-http are blocked"
        } else {
            "domain nginx inactive — public and ts-http are available"
        };
        let tailscale_note = if self.has_tailnet {
            format!(
                "tailscale up{}",
                self.tailscale_ip
                    .as_deref()
                    .map_or_else(String::new, |ip| format!(" ({ip})"))
            )
        } else {
            "tailscale down — ts modes blocked".to_string()
        };

        let lines = vec![
            Line::from(Span::styled(
                domain_note,
                Style::default().fg(if self.domain_active {
                    Color::Yellow
                } else {
                    Color::DarkGray
                }),
            )),
            Line::from(Span::styled(
                tailscale_note,
                Style::default().fg(Color::DarkGray),
            )),
            Line::from(Span::styled(
                self.notice.as_deref().unwrap_or(""),
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )),
        ];

        let block = Block::default()
            .borders(Borders::ALL)
            .title(" status ")
            .border_style(Style::default().fg(Color::DarkGray));
        f.render_widget(Paragraph::new(lines).block(block), area);
    }
}

/// Renders the exposure chooser.
pub fn render(f: &mut Frame, area: Rect, view: &ExposureView) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(2),
            Constraint::Min(0),
            Constraint::Length(5),
            Constraint::Length(3),
        ])
        .split(area);

    let title = Paragraph::new(" Ingress — exposure").style(
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    );
    f.render_widget(
        title.block(Block::default().borders(Borders::ALL)),
        chunks[0],
    );

    let hint =
        Paragraph::new(" Choose how each UI is published. Blocked modes are greyed and skipped.")
            .style(Style::default().fg(Color::DarkGray));
    f.render_widget(hint, chunks[1]);

    view.render_modes(f, chunks[2]);
    view.render_footer(f, chunks[3]);

    let help = Paragraph::new(
        "[←/→ or h/l] UI   [↑/↓ or j/k] mode   [Enter] Apply   [1-9] Page   [Esc] Back   [q] Quit",
    )
    .style(Style::default().fg(Color::DarkGray))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );
    f.render_widget(help, chunks[4]);
}

/// Whether the domain stack's reverse proxy is running right now.
///
/// WHY a container listing rather than the vhosts in `config.toml`: a box routinely
/// carries domain names for a stack that was never started, and what the chooser must
/// grey out is `public` competing with a listener that owns :80/:443 — not one the
/// operator once meant to run.
///
/// WHY `docker ps` and not `__domain.sh status`: that script reaches certbot and DNS, so
/// consulting it would make opening the chooser wait on certificate issuance. Listing
/// containers is a read-only daemon query that answers the question on its own.
///
/// WHY the filter names the service rather than the container: `container_name` carries
/// the deployment's compose project prefix, so matching `nginx-proxy` keeps this correct
/// on a box that is not named the way this repo's default happens to be.
///
/// WHY an unreachable daemon reads as inactive: a probe that cannot reach docker holds
/// no evidence of a proxy, and leaving `public` offered keeps a mode the operator can
/// still see and read the notice on, whereas blocking it offers no way back.
#[must_use]
pub fn domain_proxy_running() -> bool {
    std::process::Command::new("docker")
        .args(["ps", "--quiet", "--filter", "status=running"])
        .args(["--filter", "name=nginx-proxy"])
        .output()
        .is_ok_and(|out| out.status.success() && !out.stdout.iter().all(u8::is_ascii_whitespace))
}

/// Probes the live tailnet state, used when the operator opens the chooser.
///
/// WHY a fresh probe per open rather than a value cached in [`App`]: `tailscale up` can
/// happen while the TUI is open, and a cached answer would keep greying out the ts
/// modes after the operator has joined the tailnet.
#[must_use]
pub fn view_from_host() -> ExposureView {
    let has_tailnet = std::process::Command::new("tailscale")
        .arg("status")
        .output()
        .is_ok_and(|out| out.status.success());
    let tailscale_ip = has_tailnet
        .then(|| {
            std::process::Command::new("tailscale")
                .args(["ip", "-4"])
                .output()
                .ok()
                .filter(|out| out.status.success())
                .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
                .filter(|ip| !ip.is_empty())
        })
        .flatten();

    ExposureView::new(
        domain_stack_is_active(domain_proxy_running()),
        has_tailnet,
        tailscale_ip,
    )
}

#[cfg(test)]
mod tests {
    use super::ExposureView;
    use crate::core::expose::{Mode, UiSpec};

    fn view(domain_active: bool) -> ExposureView {
        ExposureView::new(domain_active, true, Some("100.75.203.112".to_string()))
    }

    #[test]
    fn domain_mode_blocks_public_and_ts_http() {
        let mut view = view(true);
        view.next_ui();
        let public = Mode::ALL
            .iter()
            .position(|mode| *mode == Mode::Public)
            .expect("public is in the list");
        let reason = view.block_reason(Mode::Public).expect("public is blocked");
        assert!(reason.contains("domain mode"), "{reason}");
        assert!(!view.is_selectable(public));
        let ts_http = Mode::ALL
            .iter()
            .position(|mode| *mode == Mode::TsHttp)
            .expect("ts-http is in the list");
        assert!(!view.is_selectable(ts_http));
    }

    #[test]
    fn without_the_domain_stack_public_stays_selectable() {
        let view = view(false);
        let public = Mode::ALL
            .iter()
            .position(|mode| *mode == Mode::Public)
            .expect("public is in the list");
        assert!(view.is_selectable(public));
    }

    #[test]
    fn the_cursor_never_lands_on_a_blocked_mode() {
        let mut view = view(true);
        for _ in 0..Mode::ALL.len() * 2 {
            view.next_mode();
            let mode = view.mode();
            assert!(
                view.block_reason(mode).is_none(),
                "cursor landed on blocked {mode}"
            );
        }
    }

    #[test]
    fn backwards_walking_also_avoids_blocked_modes() {
        let mut view = view(true);
        for _ in 0..Mode::ALL.len() * 2 {
            view.prev_mode();
            let mode = view.mode();
            assert!(
                view.block_reason(mode).is_none(),
                "cursor landed on blocked {mode}"
            );
        }
    }

    #[test]
    fn ui_selection_wraps_in_both_directions() {
        let mut view = view(false);
        let count = UiSpec::ALL.len();
        let first = view.ui().name;
        for _ in 0..count {
            view.next_ui();
        }
        assert_eq!(view.ui().name, first, "forward wrap");
        for _ in 0..count {
            view.prev_ui();
        }
        assert_eq!(view.ui().name, first, "backward wrap");
    }

    #[test]
    fn ts_modes_are_blocked_without_a_tailnet() {
        let view = ExposureView::new(false, false, None);
        let ts_http = Mode::ALL
            .iter()
            .position(|mode| *mode == Mode::TsHttp)
            .expect("ts-http is in the list");
        assert!(!view.is_selectable(ts_http));
        assert!(view.block_reason(Mode::TsHttps).is_some());
    }

    #[test]
    fn nginx_front_never_offers_domain_or_ts_https() {
        let mut view = view(false);
        while view.ui().bind_key != "NGINX_BIND_IP" {
            view.next_ui();
        }
        assert!(!view.is_selectable(
            Mode::ALL
                .iter()
                .position(|mode| *mode == Mode::Domain)
                .expect("domain is in the list")
        ));
        assert!(!view.is_selectable(
            Mode::ALL
                .iter()
                .position(|mode| *mode == Mode::TsHttps)
                .expect("ts-https is in the list")
        ));
    }

    #[test]
    fn the_url_preview_names_the_port_the_mode_publishes() {
        let mut view = view(false);
        let port = view.ui().default_port;
        while view.mode() != Mode::Public {
            view.next_mode();
        }
        assert!(
            view.url_preview().contains(&port.to_string()),
            "{}",
            view.url_preview()
        );

        while view.mode() != Mode::TsHttp {
            view.next_mode();
        }
        assert!(
            view.url_preview().contains("100.75.203.112"),
            "{}",
            view.url_preview()
        );
    }
}
