use subtle::ConstantTimeEq;

/// The prefixes the panel writes into `admins.authentication`, reused for the console
/// accounts so one convention covers both surfaces.
pub const BCRYPT_PREFIX: &str = "bcrypt:";
pub const PLAINTEXT_PREFIX: &str = "plaintext:";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PasswordError {
    #[error("the stored password has no supported prefix")]
    UnknownFormat,
    #[error("the stored bcrypt hash could not be parsed")]
    InvalidHash,
}

/// Verifies a candidate against a stored password. A failure to parse is an error,
/// never a false: a malformed row must not read as "wrong password" and leave the
/// operator to guess whether the account exists.
pub fn verify(stored: &str, candidate: &str) -> Result<bool, PasswordError> {
    let Some((prefix, value)) = stored.split_once(':') else {
        return Err(PasswordError::UnknownFormat);
    };
    match prefix {
        "bcrypt" => bcrypt::verify(candidate, value).map_err(|_| PasswordError::InvalidHash),
        "plaintext" => Ok(constant_time_eq(value, candidate)),
        _ => Err(PasswordError::UnknownFormat),
    }
}

/// The panel compares plaintext with timingSafeEqual for the same reason: a length
/// mismatch must not be observable from the outside.
fn constant_time_eq(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bcrypt_hash_verifies_its_own_password_only() {
        let hash = bcrypt::hash("correct horse", 4).expect("the hash is produced");
        let stored = format!("bcrypt:{hash}");
        assert_eq!(verify(&stored, "correct horse"), Ok(true));
        assert_eq!(verify(&stored, "wrong horse"), Ok(false));
    }

    #[test]
    fn a_plaintext_row_compares_exactly() {
        assert_eq!(verify("plaintext:admin", "admin"), Ok(true));
        assert_eq!(verify("plaintext:admin", "admin "), Ok(false));
        assert_eq!(verify("plaintext:admin", ""), Ok(false));
    }

    #[test]
    fn an_unprefixed_row_is_refused_rather_than_treated_as_a_password() {
        assert_eq!(
            verify("$2a$10$abcdefghijklmnop", "anything"),
            Err(PasswordError::UnknownFormat)
        );
        assert_eq!(
            verify("rot13:secret", "secret"),
            Err(PasswordError::UnknownFormat)
        );
    }

    #[test]
    fn a_corrupt_bcrypt_row_is_an_error_not_a_wrong_password() {
        assert_eq!(
            verify("bcrypt:not-a-hash", "x"),
            Err(PasswordError::InvalidHash)
        );
    }
}
