//! The `CODENAME` alphabet every username-bearing column is declared with.
//!
//! `cms.db.types.Codename` (`src/cms/db/types.py:51-66`) compiles to a Postgres
//! domain whose CHECK is `^[A-Za-z0-9_-]+$`, and `users.username`,
//! `teams.code`, `contest_usernames.username` and
//! `contest_usernames_history.username` are all declared with it. The database
//! therefore refuses a username holding any other character, and this applies
//! the same rule before a value reaches a query.
//!
//! The alphabet must not be widened. A rule that accepted, say, Unicode
//! letters would let two spellings the reference keeps apart — `Zoë` and
//! `Zoe` — reach the same row, and a login would resolve to the wrong person.
//! It must not be normalised either: the domain compares bytes, so `Alice` and
//! `alice` are two distinct usernames, and folding case here would refuse a
//! value the reference stores.
//!
//! # Errors
//!
//! [`Codename::parse`] returns [`CodenameError::Empty`] for an empty value and
//! [`CodenameError::ForbiddenCharacter`] naming the first character outside the
//! alphabet.

use std::fmt;
use std::str::FromStr;

/// Why a value is not a codename.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CodenameError {
    /// The value is empty, which the domain's `+` refuses.
    #[error("a codename must not be empty")]
    Empty,
    /// The value holds a character outside the domain's alphabet.
    #[error("a codename may hold only ASCII letters, digits, `_` and `-`, not {character:?}")]
    ForbiddenCharacter {
        /// The first character the alphabet refuses.
        character: char,
    },
}

/// A `CODENAME` value: one or more ASCII letters, digits, `_` or `-`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Codename(String);

impl Codename {
    /// Applies the domain's alphabet, preserving case and not normalising.
    ///
    /// # Errors
    ///
    /// [`CodenameError::Empty`] when the value has no characters, and
    /// [`CodenameError::ForbiddenCharacter`] for the first one the domain's
    /// class excludes.
    pub fn parse(value: &str) -> Result<Self, CodenameError> {
        if value.is_empty() {
            return Err(CodenameError::Empty);
        }
        if let Some(character) = value.chars().find(|character| !is_allowed(*character)) {
            return Err(CodenameError::ForbiddenCharacter { character });
        }
        Ok(Self(value.to_string()))
    }

    /// The value, exactly as the column stores it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Codename {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for Codename {
    type Err = CodenameError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

/// The domain's character class, one character at a time.
const fn is_allowed(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-'
}
