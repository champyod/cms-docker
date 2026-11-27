use std::net::IpAddr;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TrustedProxyError {
    #[error("not an IP address: {0}")]
    InvalidAddress(String),
    #[error("not a valid prefix: {0}")]
    InvalidPrefix(String),
    #[error("a trust-all proxy network is refused: {0}")]
    TrustAll(String),
    #[error("an IPv4-mapped network needs at least 96 bits: {0}")]
    MappedPrefix(String),
}

/// One proxy address or network whose forwarded headers the login may trust.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedProxy {
    address: IpAddr,
    prefix: u8,
}

impl TrustedProxy {
    pub fn parse(raw: &str) -> Result<Self, TrustedProxyError> {
        let raw = raw.trim();
        let (address_raw, prefix_raw) = match raw.split_once('/') {
            Some((address, prefix)) => (address.trim(), Some(prefix.trim())),
            None => (raw, None),
        };
        let original = address_raw
            .parse::<IpAddr>()
            .map_err(|_| TrustedProxyError::InvalidAddress(raw.to_string()))?;
        let address = canonical_address(original);
        let mapped = matches!((original, address), (IpAddr::V6(_), IpAddr::V4(_)));
        let prefix = match prefix_raw {
            Some(value) => value
                .parse::<u8>()
                .map_err(|_| TrustedProxyError::InvalidPrefix(raw.to_string()))?,
            None => bit_width(original),
        };
        let prefix = if mapped {
            prefix
                .checked_sub(96)
                .ok_or_else(|| TrustedProxyError::MappedPrefix(raw.to_string()))?
        } else {
            prefix
        };
        if prefix == 0 {
            return Err(TrustedProxyError::TrustAll(raw.to_string()));
        }
        if prefix > bit_width(address) {
            return Err(TrustedProxyError::InvalidPrefix(raw.to_string()));
        }
        Ok(Self { address, prefix })
    }

    pub fn contains(self, peer: IpAddr) -> bool {
        let peer = canonical_address(peer);
        match (self.address, peer) {
            (IpAddr::V4(network), IpAddr::V4(peer)) => {
                (u32::from(network) ^ u32::from(peer)) >> (32 - self.prefix) == 0
            }
            (IpAddr::V6(network), IpAddr::V6(peer)) => {
                (u128::from(network) ^ u128::from(peer)) >> (128 - self.prefix) == 0
            }
            _ => false,
        }
    }
}

pub fn parse_proxy_list(raw: &str) -> Result<Vec<TrustedProxy>, TrustedProxyError> {
    let mut proxies = Vec::new();
    for entry in raw
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let proxy = TrustedProxy::parse(entry)?;
        if !proxies.contains(&proxy) {
            proxies.push(proxy);
        }
    }
    Ok(proxies)
}

pub fn is_trusted_proxy(peer: IpAddr, proxies: &[TrustedProxy]) -> bool {
    proxies.iter().any(|proxy| proxy.contains(peer))
}

pub(crate) fn canonical_address(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(address) => address
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(address)),
        IpAddr::V4(address) => IpAddr::V4(address),
    }
}

fn bit_width(address: IpAddr) -> u8 {
    match address {
        IpAddr::V4(_) => 32,
        IpAddr::V6(_) => 128,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(raw: &str) -> TrustedProxy {
        TrustedProxy::parse(raw).expect("a valid proxy network")
    }

    #[test]
    fn an_exact_address_is_a_single_host_network() {
        let network = proxy("198.51.100.7");
        assert!(network.contains("198.51.100.7".parse().expect("a literal")));
        assert!(!network.contains("198.51.100.8".parse().expect("a literal")));
    }

    #[test]
    fn a_v4_network_contains_its_edges_and_no_neighbour() {
        let network = proxy("198.51.100.0/24");
        assert!(network.contains("198.51.100.0".parse().expect("a literal")));
        assert!(network.contains("198.51.100.255".parse().expect("a literal")));
        assert!(!network.contains("198.51.101.0".parse().expect("a literal")));
    }

    #[test]
    fn a_v6_network_contains_its_own_family_only() {
        let network = proxy("2001:db8::/32");
        assert!(network.contains("2001:db8::1".parse().expect("a literal")));
        assert!(!network.contains("2001:db9::1".parse().expect("a literal")));
        assert!(!network.contains("198.51.100.7".parse().expect("a literal")));
    }

    #[test]
    fn a_mapped_client_matches_its_v4_network() {
        let network = proxy("198.51.100.0/24");
        assert!(network.contains("::ffff:198.51.100.7".parse().expect("a literal")));
    }

    #[test]
    fn an_exact_mapped_address_is_a_single_host_network() {
        let network = proxy("::ffff:198.51.100.7");
        assert!(network.contains("198.51.100.7".parse().expect("a literal")));
        assert!(!network.contains("198.51.100.8".parse().expect("a literal")));
    }

    #[test]
    fn a_mapped_network_is_read_as_its_v4_network() {
        let network = proxy("::ffff:198.51.100.0/120");
        assert!(network.contains("198.51.100.7".parse().expect("a literal")));
    }

    #[test]
    fn a_trust_all_network_is_refused() {
        assert_eq!(
            TrustedProxy::parse("0.0.0.0/0"),
            Err(TrustedProxyError::TrustAll("0.0.0.0/0".to_string()))
        );
        assert_eq!(
            TrustedProxy::parse("::/0"),
            Err(TrustedProxyError::TrustAll("::/0".to_string()))
        );
    }

    #[test]
    fn an_invalid_network_is_refused() {
        assert!(TrustedProxy::parse("not-an-address").is_err());
        assert!(TrustedProxy::parse("198.51.100.0/33").is_err());
        assert!(TrustedProxy::parse("::ffff:198.51.100.0/64").is_err());
    }

    #[test]
    fn a_list_ignores_blank_entries_and_duplicates() {
        let proxies = parse_proxy_list(" 198.51.100.0/24, , 198.51.100.0/24 ").expect("a list");
        assert_eq!(proxies.len(), 1);
    }
}
