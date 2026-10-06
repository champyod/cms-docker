//! Input validation for the exposure chooser.
//!
//! WHY validate before writing: these values land in `.env` files that Docker Compose
//! interpolates straight into a port binding. A typo like `8888:80` or an empty value
//! does not fail at the editor, it fails at `docker compose up` with a message that
//! names a YAML line rather than the field, so the operator cannot tell which of five
//! UIs was mistyped. Validation happens while the field is still in front of them.

use std::net::Ipv4Addr;

/// The lowest port a container can be published on.
pub const MIN_PORT: u16 = 1;

/// The highest port number.
pub const MAX_PORT: u16 = 65535;

/// A validated published port.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Port(u16);

impl Port {
    /// Returns the port as a number.
    #[must_use]
    pub const fn get(self) -> u16 {
        self.0
    }
}

impl std::fmt::Display for Port {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The message shown for a number that parses but is not a publishable port.
fn out_of_range(number: u32) -> String {
    format!("{number} is out of range — enter a port between {MIN_PORT} and {MAX_PORT}")
}

/// Validates a typed port.
///
/// # Errors
///
/// Returns a message naming the accepted range when the text is not a number in
/// `[1, 65535]`. A non-numeric value gets its own message, because "must be a number"
/// is more useful than "must be between 1 and 65535" when the user typed letters.
///
/// WHY the range check is the narrowing conversion: `u16::try_from` rejects everything
/// above 65535, so the same step that keeps the value in range also keeps it honest
/// about not truncating a typed `70000` into a port that happens to exist.
pub fn parse_port(input: &str) -> Result<Port, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("port is empty — enter a number between 1 and 65535".to_string());
    }
    let Ok(number) = trimmed.parse::<u32>() else {
        return Err(format!("'{trimmed}' is not a number — enter 1 to 65535"));
    };
    match u16::try_from(number) {
        Ok(port) if port >= MIN_PORT => Ok(Port(port)),
        _ => Err(out_of_range(number)),
    }
}

/// Validates a typed Tailscale IPv4 address.
///
/// # Errors
///
/// Returns a message when the text is not a parseable IPv4 address. Tailscale assigns
/// addresses from `100.64.0.0/10`, so an address outside that range is called out
/// separately: it parses fine but no tailnet peer will ever route to it, which is a
/// failure that only shows up as an unreachable URL much later.
pub fn parse_tailscale_ip(input: &str) -> Result<Ipv4Addr, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Tailscale IP is empty — leave it blank to skip the ts modes".to_string());
    }
    let Ok(address) = trimmed.parse::<Ipv4Addr>() else {
        return Err(format!("'{trimmed}' is not an IPv4 address"));
    };
    if !is_tailscale_cgnat(address) {
        return Err(format!(
            "{address} is outside 100.64.0.0/10, which is the range Tailscale assigns from"
        ));
    }
    Ok(address)
}

/// Whether an address falls in the Tailscale CGNAT range `100.64.0.0/10`.
#[must_use]
pub const fn is_tailscale_cgnat(address: Ipv4Addr) -> bool {
    let [a, b, ..] = address.octets();
    a == 100 && (b >> 6) == 1
}

/// Whether a port is already bound on the host.
///
/// Uses `ss` rather than a bind attempt: probing by binding would itself race with
/// the service and needs privileges for ports below 1024. Returns `false` when `ss` is
/// unavailable, so a missing tool reports "not in use" rather than blocking the
/// operator on a box where the check cannot run.
///
/// # Errors
///
/// Returns `Err(())` only for an unreadable `ss` output, which is treated as unknown
/// and reported as not in use.
#[must_use]
pub fn port_is_in_use(port: u16) -> bool {
    let Ok(output) = std::process::Command::new("ss").args(["-tlnp"]).output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // ss prints `0.0.0.0:8888` / `*:8888` / `127.0.0.1:8888`, so matching the port
    // after the last colon avoids matching a remote peer in a connection table.
    text.lines().any(|line| {
        line.split_whitespace()
            .filter_map(|field| field.rsplit(':').next())
            .any(|tail| tail == port.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::{is_tailscale_cgnat, parse_port, parse_tailscale_ip, MAX_PORT, MIN_PORT};

    #[test]
    fn accepts_ports_inside_the_range() {
        assert_eq!(parse_port("80").unwrap().get(), 80);
        assert_eq!(parse_port("443").unwrap().get(), 443);
        assert_eq!(parse_port("8888").unwrap().get(), 8888);
        assert_eq!(parse_port(&MAX_PORT.to_string()).unwrap().get(), MAX_PORT);
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(parse_port("  8080  ").unwrap().get(), 8080);
    }

    #[test]
    fn rejects_zero_and_anything_above_the_maximum() {
        assert!(parse_port("0").is_err());
        assert!(parse_port("65536").is_err());
        assert!(parse_port("-1").is_err());
    }

    #[test]
    fn rejects_non_numeric_and_empty_input() {
        assert!(parse_port("").is_err());
        assert!(parse_port("   ").is_err());
        assert!(parse_port("88a8").is_err());
        assert!(parse_port("8888:80").is_err());
    }

    #[test]
    fn the_error_names_the_range() {
        let message = parse_port("70000").unwrap_err();
        assert!(message.contains(&MIN_PORT.to_string()), "{message}");
        assert!(message.contains(&MAX_PORT.to_string()), "{message}");
    }

    #[test]
    fn a_letter_typo_says_it_is_not_a_number() {
        let message = parse_port("eightyeighty").unwrap_err();
        assert!(message.contains("not a number"), "{message}");
    }

    #[test]
    fn accepts_an_address_inside_the_tailnet_range() {
        let address = parse_tailscale_ip("100.75.203.112").unwrap();
        assert_eq!(address.to_string(), "100.75.203.112");
        assert_eq!(parse_tailscale_ip("100.64.0.1").unwrap().octets()[1], 64);
        assert_eq!(
            parse_tailscale_ip("100.127.255.255").unwrap().octets()[1],
            127
        );
    }

    #[test]
    fn rejects_a_parseable_address_outside_the_tailnet_range() {
        // 10.0.0.1 parses, so the naive check would accept it and the operator would
        // only discover the mistake when the tailnet URL would not load.
        let message = parse_tailscale_ip("10.0.0.1").unwrap_err();
        assert!(message.contains("100.64.0.0/10"), "{message}");
        assert!(parse_tailscale_ip("192.168.1.1").is_err());
    }

    #[test]
    fn rejects_non_addresses_and_empty_input() {
        assert!(parse_tailscale_ip("").is_err());
        assert!(parse_tailscale_ip("not-an-ip").is_err());
        assert!(parse_tailscale_ip("100.75.203").is_err());
        assert!(parse_tailscale_ip("::1").is_err());
    }

    #[test]
    fn cgnat_boundaries_match_the_tailnet_range() {
        assert!(is_tailscale_cgnat("100.64.0.0".parse().unwrap()));
        assert!(is_tailscale_cgnat("100.127.255.255".parse().unwrap()));
        assert!(!is_tailscale_cgnat("100.63.255.255".parse().unwrap()));
        assert!(!is_tailscale_cgnat("100.128.0.0".parse().unwrap()));
        assert!(!is_tailscale_cgnat("10.64.0.1".parse().unwrap()));
    }
}
