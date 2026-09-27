//! A `DIGEST` value, and what the file cache will do with one.
//!
//! Every shape here is a value `fsobjects.digest` actually holds: forty lowercase
//! hexadecimal digits, or the one-character tombstone the domain allows beside
//! them. The rule is the check `cms.db.types` declares on the domain, so a
//! string the column would have refused is refused here instead. Nothing opens a
//! connection.

use cms_db::{
    CacheError, CacheHandle, DigestError, FileDigest, RemoveAction, DIGEST_HEX_LEN, TOMBSTONE,
};

/// A digest that is not a digest of anything, used only to exercise the shape.
const SYNTHETIC_DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

fn digest(text: &str) -> FileDigest {
    text.parse()
        .expect("digest fixture must satisfy the DIGEST domain")
}

#[test]
fn the_digest_domain_accepts_a_sha1_and_the_tombstone() {
    assert_eq!(digest(SYNTHETIC_DIGEST).as_str(), SYNTHETIC_DIGEST);
    assert_eq!(SYNTHETIC_DIGEST.len(), DIGEST_HEX_LEN);
    assert!(!digest(SYNTHETIC_DIGEST).is_tombstone());
    assert!(digest(TOMBSTONE).is_tombstone());
}

#[test]
fn the_digest_domain_refuses_everything_else_it_names() {
    assert_eq!("".parse::<FileDigest>(), Err(DigestError::Empty));
    assert_eq!(
        "abc".parse::<FileDigest>(),
        Err(DigestError::Length { found: 3 })
    );
    assert_eq!(
        "0123456789ABCDEF0123456789abcdef01234567".parse::<FileDigest>(),
        Err(DigestError::NotLowercaseHex { found: 'A' })
    );
    assert_eq!(
        "0123456789abcdef0123456789abcdef0123456g".parse::<FileDigest>(),
        Err(DigestError::NotLowercaseHex { found: 'g' })
    );
    assert_eq!(
        "X".parse::<FileDigest>(),
        Err(DigestError::Length { found: 1 })
    );
}

#[test]
fn the_file_cache_refuses_the_tombstone_and_keeps_it_out_of_a_removal() {
    let stored = CacheHandle::new(digest(SYNTHETIC_DIGEST));
    let gone = CacheHandle::new(FileDigest::tombstone());

    assert_eq!(stored.open().map(FileDigest::as_str), Ok(SYNTHETIC_DIGEST));
    assert_eq!(gone.open().err(), Some(CacheError::Tombstone));
    assert_eq!(stored.remove(), RemoveAction::Forward);
    assert_eq!(gone.remove(), RemoveAction::Skipped);
    assert!(gone.is_tombstone() && !stored.is_tombstone());
}
