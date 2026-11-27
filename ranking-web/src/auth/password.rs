/// The prefixes the panel writes into `admins.authentication`, reused for the console
/// accounts so one convention covers both surfaces.
pub const BCRYPT_PREFIX: &str = "bcrypt:";
pub const PLAINTEXT_PREFIX: &str = "plaintext:";

/// bcrypt reads at most 72 UTF-8 bytes; the core refuses a longer candidate, so the console does too.
const MAX_PASSWORD_BYTES: usize = 72;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PasswordError {
    #[error("the stored password has no supported prefix")]
    UnknownFormat,
    #[error("the stored bcrypt hash could not be parsed")]
    InvalidHash,
    #[error("the stored password is plaintext; the console refuses to authenticate it")]
    PlaintextRefused,
}

/// Verifies a candidate against a stored password. A failure to parse is an error,
/// never a false: a malformed row must not read as "wrong password" and leave the
/// operator to guess whether the account exists.
pub fn verify(stored: &str, candidate: &str) -> Result<bool, PasswordError> {
    let Some((prefix, value)) = stored.split_once(':') else {
        return Err(PasswordError::UnknownFormat);
    };
    match prefix {
        "bcrypt" => {
            if candidate.len() > MAX_PASSWORD_BYTES {
                return Ok(false);
            }
            bcrypt::verify(candidate, value).map_err(|_| PasswordError::InvalidHash)
        }
        // The core refuses these rows for the reason it states: honouring one hands the account
        // to anyone who can read the database, so the console fails closed with it.
        "plaintext" => Err(PasswordError::PlaintextRefused),
        _ => Err(PasswordError::UnknownFormat),
    }
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
    fn a_72_byte_password_still_verifies() {
        let password = "x".repeat(72);
        let hash = bcrypt::hash(&password, 4).expect("the hash is produced");
        let stored = format!("bcrypt:{hash}");
        assert_eq!(verify(&stored, &password), Ok(true));
    }

    #[test]
    fn a_longer_candidate_does_not_extend_a_72_byte_password() {
        let password = "x".repeat(72);
        let hash = bcrypt::hash(&password, 4).expect("the hash is produced");
        let stored = format!("bcrypt:{hash}");
        assert_eq!(verify(&stored, &format!("{password}x")), Ok(false));
    }

    #[test]
    fn a_64_byte_password_remains_usable() {
        let password = "a".repeat(64);
        let hash = bcrypt::hash(&password, 4).expect("the hash is produced");
        let stored = format!("bcrypt:{hash}");
        assert_eq!(verify(&stored, &password), Ok(true));
    }

    #[test]
    fn a_plaintext_row_is_refused_rather_than_compared() {
        // The panel used to accept this row, which re-created the hole the core closed.
        assert_eq!(
            verify("plaintext:admin", "admin"),
            Err(PasswordError::PlaintextRefused)
        );
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
