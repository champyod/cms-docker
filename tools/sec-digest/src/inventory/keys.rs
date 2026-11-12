//! Product keys: the vocabulary shared by the inventory, the feeds and ranking.

use std::sync::LazyLock;

use regex::Regex;

use crate::matchtext::{alternation, bounded_matches};

/// Canonical product key -> display name; matched against advisory product names.
const PRODUCTS: &[(&str, &str)] = &[
    ("linux", "Linux kernel"),
    ("openssl", "OpenSSL"),
    ("postgres", "PostgreSQL"),
    ("redis", "Redis"),
    ("nginx", "nginx"),
    ("vault", "HashiCorp Vault"),
    ("grafana", "Grafana"),
    ("prometheus", "Prometheus"),
    ("node_exporter", "node_exporter"),
    ("tailscale", "Tailscale"),
    ("diun", "Diun"),
    ("renovate", "Renovate"),
    ("crowdsec", "CrowdSec"),
    ("caddy", "Caddy"),
    ("modsecurity", "ModSecurity CRS"),
    ("bun", "Bun"),
    ("next", "Next.js"),
    ("prisma", "Prisma"),
    ("react", "React"),
    ("alpine", "Alpine Linux"),
    ("ubuntu", "Ubuntu"),
    ("drogon", "Drogon"),
    ("simdjson", "simdjson"),
    ("sqlpp23", "sqlpp23"),
    ("htmx", "htmx"),
    ("tailwind", "Tailwind CSS"),
    ("isolate", "isolate"),
    ("trivy", "Trivy"),
    ("postgres_image", "PostgreSQL"),
    ("docker", "Docker Engine"),
];

/// Token -> product key, used for image names, CPE products and advisory text.
const TOKENS: &[(&str, &str)] = &[
    ("linux", "linux"),
    ("kernel", "linux"),
    ("linux_kernel", "linux"),
    ("openssl", "openssl"),
    ("libssl", "openssl"),
    ("libcrypto", "openssl"),
    ("postgresql", "postgres"),
    ("postgres", "postgres"),
    ("redis", "redis"),
    ("valkey", "redis"),
    ("nginx", "nginx"),
    ("vault", "vault"),
    ("hashicorp", "vault"),
    ("grafana", "grafana"),
    ("prometheus", "prometheus"),
    ("node_exporter", "node_exporter"),
    ("node-exporter", "node_exporter"),
    ("tailscale", "tailscale"),
    ("diun", "diun"),
    ("renovate", "renovate"),
    ("crowdsec", "crowdsec"),
    ("caddy", "caddy"),
    ("modsecurity", "modsecurity"),
    ("crs", "modsecurity"),
    ("bun", "bun"),
    ("next", "next"),
    ("nextjs", "next"),
    ("next.js", "next"),
    ("prisma", "prisma"),
    ("react", "react"),
    ("alpine", "alpine"),
    ("ubuntu", "ubuntu"),
    ("drogon", "drogon"),
    ("simdjson", "simdjson"),
    ("sqlpp23", "sqlpp23"),
    ("htmx", "htmx"),
    ("tailwindcss", "tailwind"),
    ("tailwind", "tailwind"),
    ("isolate", "isolate"),
    ("trivy", "trivy"),
    ("docker", "docker"),
];

static TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
    let tokens: Vec<&str> = TOKENS.iter().map(|(token, _)| *token).collect();
    alternation(&tokens)
});

/// Canonical product key for a name, or `None` when it is not our software.
pub fn key_for(name: &str) -> Option<&'static str> {
    let lowered = name.trim().to_lowercase();
    if let Some(key) = token_key(&lowered) {
        return Some(key);
    }
    let tail = lowered.rsplit('/').next().unwrap_or(&lowered);
    token_key(tail)
}

fn token_key(token: &str) -> Option<&'static str> {
    TOKENS
        .iter()
        .find(|(name, _)| *name == token)
        .map(|(_, key)| *key)
}

pub fn product_name(key: &str) -> String {
    PRODUCTS
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, display)| (*display).to_string())
        .unwrap_or_else(|| key.to_string())
}

/// Product keys mentioned in free text (advisory titles, KEV vendor/product pairs).
pub fn products_in_text(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let mut keys: Vec<&str> = Vec::new();
    for hit in bounded_matches(&lowered, &TOKEN_RE) {
        if let Some(key) = token_key(&hit) {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    }
    keys.sort_unstable();
    keys.into_iter().map(str::to_string).collect()
}
