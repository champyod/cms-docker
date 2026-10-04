//! The annotation vocabulary a config catalog is written in.
//!
//! `config.toml.example` declares what each key means through a trailing
//! `#` comment on the key's own line. The leading token names the value type;
//! `@`-prefixed tokens carry metadata. This module owns those tokens as types
//! so the parser that reads a file and the layers that consume a spec agree on
//! one definition.

/// Value domain a config key accepts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ValueType {
    /// Free-form text. The default when a key carries no type token.
    Str,
    /// A non-negative integer.
    Num,
    /// `true` or `false`.
    Bool,
    /// A TCP port: an integer in 1..=65535.
    Port,
    /// An `http://` or `https://` URL; empty is allowed.
    Url,
    /// Text that is masked in the UI and regenerated when empty.
    Secret,
    /// One of a fixed set of literals, e.g. `enum:0,1`.
    Enum,
}

impl ValueType {
    /// Returns the type named by `token`, or `None` when it names none.
    #[must_use]
    pub fn parse(token: &str) -> Option<Self> {
        match token.trim() {
            "str" => Some(Self::Str),
            "num" => Some(Self::Num),
            "bool" => Some(Self::Bool),
            "port" => Some(Self::Port),
            "url" => Some(Self::Url),
            "secret" => Some(Self::Secret),
            other => other.strip_prefix("enum:").map(|_| Self::Enum),
        }
    }

    /// Reports whether `value` is acceptable for this type.
    ///
    /// An empty value is accepted for every non-required type: it is the signal
    /// that the resolver should fall back to the next layer rather than a value
    /// that failed to parse.
    #[must_use]
    pub fn accepts(self, value: &str) -> bool {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return true;
        }
        match self {
            Self::Str | Self::Secret => true,
            Self::Num => trimmed.chars().all(|c| c.is_ascii_digit()),
            Self::Bool => matches!(trimmed, "true" | "false"),
            Self::Port => trimmed
                .parse::<u32>()
                .is_ok_and(|p| (1..=65535).contains(&p)),
            Self::Url => trimmed.starts_with("http://") || trimmed.starts_with("https://"),
            Self::Enum => true,
        }
    }
}

/// Which resolver layer a key is declared at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// A shared value every layer may fall back to.
    Base,
    /// One value per stack, overridable per instance.
    Stack,
    /// Settable only at the instance layer.
    Instance,
}

impl Scope {
    /// Returns the scope named by `token`, defaulting to [`Scope::Stack`].
    #[must_use]
    pub fn parse(token: &str) -> Self {
        match token.trim() {
            "base" => Self::Base,
            "instance" => Self::Instance,
            _ => Self::Stack,
        }
    }
}

/// How a missing secret or empty value is produced.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Generator {
    /// Leave empty; nothing is generated.
    None,
    /// 32 random bytes as hex.
    Hex32,
    /// A random alphanumeric password.
    RandPw,
    /// The host's public IPv4 address, detected at sync time.
    LiveIp,
    /// The group id owning `/var/run/docker.sock`.
    DockerGid,
    /// The value of another key, named by the token that follows `mirror:`.
    ///
    /// The key name itself is carried by the spec that owns the annotation, so
    /// this stays `Copy` and a spec can be passed around cheaply.
    Mirror,
}

impl Generator {
    /// Returns the generator named by `token`, defaulting to [`Generator::None`].
    #[must_use]
    pub fn parse(token: &str) -> Self {
        match token.trim() {
            "hex32" => Self::Hex32,
            "rand_pw" => Self::RandPw,
            "live_ip" => Self::LiveIp,
            "docker_gid" => Self::DockerGid,
            other => match other.strip_prefix("mirror:") {
                Some(source) if !source.is_empty() => Self::Mirror,
                _ => Self::None,
            },
        }
    }

    /// Returns the source key named by `token` for a [`Generator::Mirror`].
    #[must_use]
    pub fn mirror_source(token: &str) -> Option<&str> {
        match token.trim().strip_prefix("mirror:") {
            Some(source) if !source.is_empty() => Some(source),
            _ => None,
        }
    }
}

#[cfg(test)]
#[path = "config_schema_kinds_tests.rs"]
mod tests;
