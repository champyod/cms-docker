//! Exposure model — which address each UI publishes on, and which modes it allows.
//!
//! WHY this is pure logic with no I/O: the rules that decide whether a mode is legal
//! for a UI are the ones an operator gets wrong. Keeping them here means they are
//! unit-tested rather than discovered by deploying a box that is reachable from the
//! whole LAN when it was meant to be private.

use std::fmt;

/// A publishable UI and the backend port it fronts.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ui {
    /// Contestant-facing contest web server.
    ContestWeb,
    /// The standalone contest nginx that owns :80/:443 without the domain stack.
    NginxFront,
    /// Legacy Python admin UI, served under `/classic/` by the admin vhost.
    ClassicAdmin,
    /// Public ranking board.
    Ranking,
    /// Next.js admin panel.
    AdminPanel,
}

/// How a UI is reached.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Bound to 127.0.0.1 — reachable only from the host itself.
    Local,
    /// Bound to 0.0.0.0 — reachable on every interface, including the school LAN.
    Public,
    /// Bound to the Tailscale IP — plain HTTP over the encrypted tailnet.
    TsHttp,
    /// Bound to loopback plus a `tailscale serve` HTTPS listener.
    TsHttps,
    /// Loopback behind the domain nginx, which owns :80/:443 and the certificate.
    Domain,
}

impl Mode {
    /// The human label shown in the chooser.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Public => "public",
            Self::TsHttp => "ts-http",
            Self::TsHttps => "ts-https",
            Self::Domain => "domain",
        }
    }

    /// Every mode, in the order the chooser lists them.
    pub const ALL: [Self; 5] = [
        Self::Local,
        Self::Public,
        Self::TsHttp,
        Self::TsHttps,
        Self::Domain,
    ];
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// Static facts about one UI: where its bind address lives and what it fronts.
#[derive(Clone, Copy, Debug)]
pub struct UiSpec {
    /// Stable identifier, also the `.env` comment used in the letter.
    pub name: &'static str,
    /// The env file holding the bind address.
    pub env_file: &'static str,
    /// The key in that file holding the bind address.
    pub bind_key: &'static str,
    /// The key holding the externally published port.
    pub port_key: &'static str,
    /// Default published port.
    pub default_port: u16,
    /// The `TS_HTTPS_*` key, when the UI can be served by `tailscale serve`.
    pub ts_serve_key: Option<&'static str>,
    /// Default `tailscale serve` HTTPS port.
    pub default_https_port: u16,
    /// Modes this UI cannot use at all, regardless of what else is configured.
    pub unsupported: &'static [Mode],
}

impl UiSpec {
    /// All publishable UIs in chooser order.
    pub const ALL: [Self; 5] = [
        Self::CONTEST_WEB,
        Self::NGINX_FRONT,
        Self::CLASSIC_ADMIN,
        Self::RANKING,
        Self::ADMIN_PANEL,
    ];

    const CONTEST_WEB: Self = Self {
        name: "contest-web",
        env_file: ".env.contest",
        bind_key: "CONTEST_BIND_IP",
        port_key: "CONTEST_PORT_EXTERNAL",
        default_port: 8888,
        ts_serve_key: Some("TS_HTTPS_CONTEST"),
        default_https_port: 8846,
        unsupported: &[],
    };

    /// WHY nginx-front carries no `ts-https` and no `domain`: those two modes mean
    /// "something else already owns :80/:443 and the certificate", which is exactly
    /// what this container is. Offering them would let the operator point it at
    /// itself.
    const NGINX_FRONT: Self = Self {
        name: "nginx-front",
        env_file: ".env.contest",
        bind_key: "NGINX_BIND_IP",
        port_key: "NGINX_HTTP_PORT",
        default_port: 80,
        ts_serve_key: None,
        default_https_port: 0,
        unsupported: &[Mode::TsHttps, Mode::Domain],
    };

    const CLASSIC_ADMIN: Self = Self {
        name: "classic-admin",
        env_file: ".env.admin",
        bind_key: "ADMIN_BIND_IP",
        port_key: "ADMIN_PORT_EXTERNAL",
        default_port: 8889,
        ts_serve_key: Some("TS_HTTPS_CLASSIC"),
        default_https_port: 8844,
        unsupported: &[],
    };

    const RANKING: Self = Self {
        name: "ranking",
        env_file: ".env.admin",
        bind_key: "RANKING_BIND_IP",
        port_key: "RANKING_PORT_EXTERNAL",
        default_port: 8890,
        ts_serve_key: Some("TS_HTTPS_RANKING"),
        default_https_port: 8845,
        unsupported: &[],
    };

    const ADMIN_PANEL: Self = Self {
        name: "admin-panel",
        env_file: ".env.admin",
        bind_key: "ADMIN_NEXT_BIND_IP",
        port_key: "ADMIN_NEXT_PORT_EXTERNAL",
        default_port: 8891,
        ts_serve_key: Some("TS_HTTPS_PANEL"),
        default_https_port: 8843,
        unsupported: &[],
    };

    /// Returns the spec for a chooser index.
    #[must_use]
    pub const fn at(index: usize) -> &'static Self {
        &Self::ALL[index]
    }
}

impl fmt::Display for UiSpec {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

/// Whether the domain nginx currently owns :80/:443 for the whole host.
///
/// WHY this is a host-wide fact and not a per-UI one: the domain stack publishes one
/// `nginx-proxy` container on 80 and 443 that reverse-proxies every configured
/// vhost. Once it is up, any UI also bound to `0.0.0.0` on a port the operator is
/// about to forward competes with it for the same inbound traffic.
#[must_use]
pub fn domain_stack_is_active(domains_configured: usize, access_is_domain: bool) -> bool {
    access_is_domain && domains_configured > 0
}

/// Whether a mode may be chosen for a UI right now.
///
/// Returns the reason it may not, or `None` when it is legal. A blocked mode is
/// shown greyed rather than hidden, so the operator can see the mode exists and why
/// it is unavailable instead of wondering where it went.
///
/// # Errors
///
/// Returns `Err(reason)` when the mode is unavailable. Callers render the reason;
/// this function never mutates state.
pub fn mode_allowed(spec: &UiSpec, mode: Mode, tailscale_up: bool) -> Result<(), String> {
    if spec.unsupported.contains(&mode) {
        return Err(format!(
            "{spec} is published by the proxy itself — no {mode} mode"
        ));
    }
    if (mode == Mode::TsHttp || mode == Mode::TsHttps) && !tailscale_up {
        return Err("Tailscale is not running — run 'tailscale up' first".to_string());
    }
    if mode == Mode::TsHttps && spec.ts_serve_key.is_none() {
        return Err(format!("{spec} has no tailscale serve entry"));
    }
    Ok(())
}

/// Which modes conflict with the domain nginx owning :80/:443.
///
/// WHY public and ts-http are the two: both publish the UI's own port on a routable
/// address, so the operator would be forwarding the same traffic twice and the
/// bypass would skip TLS, rate limits and the ACME challenge route. `local` and
/// `ts-https` bind loopback and stay behind the proxy, and `domain` is the mode that
/// turns the nginx on.
#[must_use]
pub fn mode_conflicts_with_domain(mode: Mode) -> bool {
    matches!(mode, Mode::Public | Mode::TsHttp)
}

/// The bind address a mode writes into the env file.
///
/// Returns the literal address, or `None` when the mode cannot be expressed as one:
/// [`Mode::TsHttp`] has no address until a Tailscale IP is known.
///
/// # Errors
///
/// Returns `None` for `TsHttp` without a Tailscale IP. `TsHttps` binds loopback like
/// `Local` and is distinguished by the `tailscale serve` entry, not by the address.
#[must_use]
pub fn bind_address_for(mode: Mode, tailscale_ip: Option<&str>) -> Option<String> {
    match mode {
        Mode::Local | Mode::Domain | Mode::TsHttps => Some("127.0.0.1".to_string()),
        Mode::Public => Some("0.0.0.0".to_string()),
        Mode::TsHttp => tailscale_ip.map(ToString::to_string),
    }
}

/// Infers the mode a UI is currently in from its stored state.
///
/// WHY inference rather than a stored mode flag: the `.env` files are edited by hand
/// as often as by the TUI, and a mode recorded in a separate field would silently
/// disagree with the bind address that is actually in force.
#[must_use]
pub fn mode_from_bind(bind: &str, tailscale_ip: Option<&str>, serve_active: bool) -> Mode {
    let trimmed = bind.trim();
    if trimmed.is_empty() || trimmed == "0.0.0.0" || trimmed == "*" {
        return Mode::Public;
    }
    if trimmed == "127.0.0.1" {
        return if serve_active {
            Mode::TsHttps
        } else {
            Mode::Local
        };
    }
    if let Some(ts_ip) = tailscale_ip {
        if trimmed == ts_ip {
            return Mode::TsHttp;
        }
    }
    // A literal Tailscale address that no longer matches the current tailnet is
    // reported as public, because what matters is that the operator is looking at the
    // mode the traffic actually takes.
    Mode::Public
}

#[cfg(test)]
mod tests {
    use super::{
        bind_address_for, domain_stack_is_active, mode_allowed, mode_conflicts_with_domain,
        mode_from_bind, Mode, UiSpec,
    };

    #[test]
    fn every_ui_has_a_unique_name_and_bind_key() {
        let mut names: Vec<&str> = UiSpec::ALL.iter().map(|s| s.name).collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "two UIs share a name");

        let mut keys: Vec<&str> = UiSpec::ALL.iter().map(|s| s.bind_key).collect();
        keys.sort_unstable();
        let key_count = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), key_count, "two UIs share a bind key");
    }

    #[test]
    fn nginx_front_rejects_the_modes_it_itself_provides() {
        let spec = UiSpec::at(1);
        assert!(mode_allowed(spec, Mode::Domain, true).is_err());
        assert!(mode_allowed(spec, Mode::TsHttps, true).is_err());
        assert!(mode_allowed(spec, Mode::Local, false).is_ok());
        assert!(mode_allowed(spec, Mode::Public, false).is_ok());
    }

    #[test]
    fn tailscale_modes_require_a_running_tailscale() {
        let spec = UiSpec::at(0);
        assert!(mode_allowed(spec, Mode::TsHttp, false).is_err());
        assert!(mode_allowed(spec, Mode::TsHttps, false).is_err());
        assert!(mode_allowed(spec, Mode::TsHttp, true).is_ok());
    }

    #[test]
    fn domain_and_local_stay_available_without_tailscale() {
        for index in 0..UiSpec::ALL.len() {
            let spec = UiSpec::at(index);
            if spec.unsupported.contains(&Mode::Domain) {
                continue;
            }
            assert!(mode_allowed(spec, Mode::Local, false).is_ok(), "{spec}");
            assert!(mode_allowed(spec, Mode::Domain, false).is_ok(), "{spec}");
        }
    }

    #[test]
    fn public_and_ts_http_are_the_modes_domain_blocks() {
        assert!(mode_conflicts_with_domain(Mode::Public));
        assert!(mode_conflicts_with_domain(Mode::TsHttp));
        assert!(!mode_conflicts_with_domain(Mode::Local));
        assert!(!mode_conflicts_with_domain(Mode::TsHttps));
        assert!(!mode_conflicts_with_domain(Mode::Domain));
    }

    #[test]
    fn domain_stack_needs_both_a_domain_and_the_access_method() {
        assert!(domain_stack_is_active(1, true));
        assert!(domain_stack_is_active(4, true));
        assert!(!domain_stack_is_active(0, true), "no domain configured");
        assert!(!domain_stack_is_active(4, false), "still on public_port");
    }

    #[test]
    fn mode_labels_are_distinct() {
        let mut labels: Vec<&str> = Mode::ALL.iter().map(|m| m.label()).collect();
        labels.sort_unstable();
        let count = labels.len();
        labels.dedup();
        assert_eq!(labels.len(), count);
    }

    #[test]
    fn bind_address_matches_the_documented_wiring() {
        let ts = Some("100.75.203.112");
        assert_eq!(
            bind_address_for(Mode::Local, ts).as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(
            bind_address_for(Mode::Public, ts).as_deref(),
            Some("0.0.0.0")
        );
        assert_eq!(
            bind_address_for(Mode::Domain, ts).as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(
            bind_address_for(Mode::TsHttps, ts).as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(
            bind_address_for(Mode::TsHttp, ts).as_deref(),
            Some("100.75.203.112")
        );
    }

    #[test]
    fn ts_http_has_no_address_without_a_tailnet() {
        assert_eq!(bind_address_for(Mode::TsHttp, None), None);
    }

    #[test]
    fn empty_bind_is_read_as_public_not_local() {
        // An unset key falls back to 0.0.0.0 in the compose files, so reading an empty
        // value as local would understate how reachable a box actually is.
        assert_eq!(mode_from_bind("", None, false), Mode::Public);
        assert_eq!(mode_from_bind("0.0.0.0", None, false), Mode::Public);
        assert_eq!(mode_from_bind("*", None, false), Mode::Public);
    }

    #[test]
    fn loopback_with_a_serve_entry_is_ts_https() {
        assert_eq!(mode_from_bind("127.0.0.1", None, true), Mode::TsHttps);
        assert_eq!(mode_from_bind("127.0.0.1", None, false), Mode::Local);
    }

    #[test]
    fn a_tailnet_address_is_recognised_and_a_stale_one_is_not() {
        let ts = Some("100.75.203.112");
        assert_eq!(mode_from_bind("100.75.203.112", ts, false), Mode::TsHttp);
        assert_eq!(mode_from_bind("100.99.99.99", ts, false), Mode::Public);
    }
}
