//! The stored form of a credential, as `admins.authentication` holds it.
//!
//! The column is a single string, `<method>:<payload>`, and
//! `cmscommon.crypto.parse_authentication` splits it on the first colon and
//! `validate_password` then dispatches on the method. Only `plaintext` and
//! `bcrypt` exist; anything else is a value the Python side would raise on.
//!
//! Splitting is reproduced exactly, including a payload that itself contains a
//! colon, and the plaintext payload is compared in constant time the way
//! `hmac.compare_digest` compares it. Neither form is ever formatted, because a
//! derived `Debug` on either one would put the secret in a log line.

use std::fmt;

use subtle::ConstantTimeEq;

const PLAINTEXT: &str = "plaintext";
const BCRYPT: &str = "bcrypt";

/// Shown in place of a payload wherever a credential is formatted.
const REDACTED: &str = "<redacted>";

/// Why a stored credential was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// The string held no colon, so there is no method to dispatch on.
    NoMethodSeparator,
    /// The method is neither `plaintext` nor `bcrypt`.
    UnknownMethod {
        /// The method that was found.
        method: String,
    },
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoMethodSeparator => {
                write!(
                    f,
                    "authentication string has no `:` separating method and payload"
                )
            }
            Self::UnknownMethod { method } => {
                write!(f, "authentication method `{method}` is not known")
            }
        }
    }
}

impl std::error::Error for AuthError {}

/// A credential held in the clear, compared in constant time.
#[derive(Clone, PartialEq, Eq)]
pub struct PlaintextPassword(String);

impl PlaintextPassword {
    /// A stored plaintext payload, which the column may legitimately hold empty.
    #[must_use]
    pub fn new(secret: impl Into<String>) -> Self {
        Self(secret.into())
    }

    /// Whether a candidate is this password.
    ///
    /// The comparison is over the UTF-8 bytes and costs what a match costs, so a
    /// rejected login cannot be narrowed down one byte at a time. The length is
    /// not hidden, for the reason `check_rpc_secret` gives: the client chose it.
    #[must_use]
    pub fn matches(&self, candidate: &str) -> bool {
        bool::from(self.0.as_bytes().ct_eq(candidate.as_bytes()))
    }
}

impl fmt::Debug for PlaintextPassword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// The bcrypt half of a credential, whose check belongs to a verifier.
#[derive(Clone, PartialEq, Eq)]
pub struct BcryptPassword(String);

/// The bcrypt check a [`BcryptPassword`] is validated against.
///
/// A stored hash cannot be checked without the cost it was built with, so the
/// check is supplied rather than assumed. There is no implementation here: the
/// password hashing that computes and compares those hashes is not part of this
/// mapping, and a default that answered `false` would report a valid credential
/// as wrong.
pub trait BcryptVerifier {
    /// Whether `candidate` is the password `hash` was built from.
    fn verify(&self, candidate: &str, hash: &str) -> bool;
}

impl BcryptPassword {
    /// A stored bcrypt payload, exactly as the column holds it.
    #[must_use]
    pub fn new(hash: impl Into<String>) -> Self {
        Self(hash.into())
    }

    /// The stored hash, for handing to a verifier.
    #[must_use]
    pub fn hash(&self) -> &str {
        &self.0
    }

    /// Whether a candidate is this password, as the supplied verifier decides.
    #[must_use]
    pub fn matches(&self, candidate: &str, verifier: &impl BcryptVerifier) -> bool {
        verifier.verify(candidate, &self.0)
    }
}

impl fmt::Debug for BcryptPassword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// A stored credential, split into the method that verifies it and its payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasswordForm {
    /// The payload is the password itself.
    Plaintext(PlaintextPassword),
    /// The payload is a hash to check with [`BcryptVerifier`].
    Bcrypt(BcryptPassword),
}

impl PasswordForm {
    /// Splits an `admins.authentication` value on its first colon.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError::NoMethodSeparator`] when there is no colon, and
    /// [`AuthError::UnknownMethod`] for a method `validate_password` does not
    /// know. Both are the two cases the Python side refuses, and refusing them
    /// here keeps a stored credential from being treated as verified.
    pub fn parse(authentication: &str) -> Result<Self, AuthError> {
        let (method, payload) = authentication
            .split_once(':')
            .ok_or(AuthError::NoMethodSeparator)?;
        match method {
            PLAINTEXT => Ok(Self::Plaintext(PlaintextPassword::new(payload))),
            BCRYPT => Ok(Self::Bcrypt(BcryptPassword::new(payload))),
            other => Err(AuthError::UnknownMethod {
                method: other.to_string(),
            }),
        }
    }

    /// The plaintext payload, when the credential is stored in the clear.
    #[must_use]
    pub const fn plaintext(&self) -> Option<&PlaintextPassword> {
        match self {
            Self::Plaintext(secret) => Some(secret),
            Self::Bcrypt(_) => None,
        }
    }

    /// The bcrypt payload, when the credential is stored as a hash.
    #[must_use]
    pub const fn bcrypt(&self) -> Option<&BcryptPassword> {
        match self {
            Self::Bcrypt(hash) => Some(hash),
            Self::Plaintext(_) => None,
        }
    }
}
