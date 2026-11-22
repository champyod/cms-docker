//! What one service exposes: its method table and the gate it serves it under.

use std::collections::HashSet;

use cms_proto::{dispatch, Decision, GateConfig, Method};
use serde_json::Value;

/// A name two entries answer to, refused when the registry is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DuplicateMethod(
    /// The name that appears more than once.
    pub &'static str,
);

impl std::fmt::Display for DuplicateMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "method `{}` is registered twice", self.0)
    }
}

impl std::error::Error for DuplicateMethod {}

/// The methods a host answers for, together with the gate settings they are served under.
pub struct Registry {
    methods: Vec<Method>,
    secret: Option<String>,
    is_backdoor_enabled: bool,
}

impl Registry {
    /// Takes the table, refusing a name twice because lookup answers only the first entry.
    pub fn new(methods: Vec<Method>, config: GateConfig<'_>) -> Result<Self, DuplicateMethod> {
        ensure_unique(&methods)?;
        Ok(Self {
            methods,
            secret: config.secret.map(str::to_owned),
            is_backdoor_enabled: config.is_backdoor_enabled,
        })
    }

    /// The table as the gate takes it.
    #[must_use]
    pub fn methods(&self) -> &[Method] {
        &self.methods
    }

    /// The settings the gate decides this host's calls with.
    #[must_use]
    pub fn gate(&self) -> GateConfig<'_> {
        GateConfig {
            secret: self.secret.as_deref(),
            is_backdoor_enabled: self.is_backdoor_enabled,
        }
    }

    /// Runs one decoded message through the gate, which is the only judge here.
    #[must_use]
    pub fn decide(&self, envelope: &Value) -> Decision {
        dispatch(envelope, &self.methods, &self.gate())
    }
}

/// Reports the first name that appears twice, if any.
fn ensure_unique(methods: &[Method]) -> Result<(), DuplicateMethod> {
    let mut seen = HashSet::with_capacity(methods.len());
    for entry in methods {
        if !seen.insert(entry.name) {
            return Err(DuplicateMethod(entry.name));
        }
    }
    Ok(())
}
