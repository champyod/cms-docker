//! The `token_mode` enum, which both `contests` and `tasks` store.
//!
//! One type, not two: `contest.py:157` and `task.py:133` declare the same three
//! values from the same constants in `cms/__init__.py`, and the two tables differ
//! only in their **default** (`contests` defaults to `infinite`, `tasks` to
//! `disabled`). A second copy of the enum is a second place to forget `mixed`,
//! which the server derives at render time and never stores.

use std::str::FromStr;

/// One of the three values the `token_mode` enum stores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TokenMode {
    /// `disabled`: no token may be played.
    Disabled,
    /// `finite`: tokens accrue from the generation parameters.
    Finite,
    /// `infinite`: a token is always available.
    Infinite,
}

impl TokenMode {
    /// The spelling the enum stores.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Finite => "finite",
            Self::Infinite => "infinite",
        }
    }

    /// How this mode answers a request for a token.
    #[must_use]
    pub const fn grant(self) -> TokenGrant {
        match self {
            Self::Disabled => TokenGrant::Never,
            Self::Finite => TokenGrant::Accrued,
            Self::Infinite => TokenGrant::Always,
        }
    }

    /// The mode a column value names, or `None` for one the enum does not declare.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "disabled" => Some(Self::Disabled),
            "finite" => Some(Self::Finite),
            "infinite" => Some(Self::Infinite),
            _ => None,
        }
    }
}

impl FromStr for TokenMode {
    type Err = TokenModeError;

    /// # Errors
    ///
    /// Returns [`TokenModeError::Unknown`] for every spelling outside the enum,
    /// which is what the column cast refuses too.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value).ok_or_else(|| TokenModeError::Unknown(value.to_string()))
    }
}

/// How a mode answers a token request, before any timestamp is considered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenGrant {
    /// `disabled`: the answer is always no.
    Never,
    /// `infinite`: the answer is always yes.
    Always,
    /// `finite`: the answer depends on the generation history.
    Accrued,
}

/// Why a spelling is not a `token_mode` value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TokenModeError {
    /// The value is not one of the three enum labels.
    #[error("{0:?} is not a token mode; the column stores disabled, finite or infinite")]
    Unknown(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mode_round_trips_through_its_spelling() {
        for mode in [TokenMode::Disabled, TokenMode::Finite, TokenMode::Infinite] {
            assert_eq!(mode.as_str().parse::<TokenMode>(), Ok(mode));
        }
    }

    #[test]
    fn mixed_is_not_stored_even_though_the_server_renders_it() {
        // `TOKEN_MODE_MIXED` exists in cms/__init__.py but is derived per render.
        assert_eq!(TokenMode::parse("mixed"), None);
        assert_eq!(
            "mixed".parse::<TokenMode>(),
            Err(TokenModeError::Unknown("mixed".to_owned()))
        );
    }
}
