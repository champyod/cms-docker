//! The secrets half of `cmscommon.crypto`: keys, ciphertext, numbers and the
//! stored form of a password.
//!
//! # The cipher is fixed by the data, not chosen here
//!
//! `encrypt_binary` is AES-128-CBC under a 16-byte key with a 16-byte random IV
//! prepended, and a padding of one `0x01` byte followed by `0x00` bytes up to the
//! next block. The whole `iv || ciphertext` is then standard base64 with three
//! characters swapped for URL safety: `+`→`-`, `/`→`_`, `=`→`.`.
//!
//! Three things about it are worth stating plainly, because all three are
//! load-bearing:
//!
//! * The key is **16 bytes**, not 32. `crypto.py:107` calls `get_random_key()`,
//!   which reads 16 bytes (`crypto.py:73`), so `AES.new` builds AES-128. The
//!   slice brief calls the construction AES-256; the code is AES-128, and this
//!   port follows the code because the code is what wrote the ciphertext.
//! * The padding is **not** PKCS#7 — it is `0x01` then `0x00` to the block.
//!   It is invertible, but it is never *checked*: `crypto.py:139` has a `TODO`
//!   where the check would be, so a wrong key or a flipped ciphertext byte
//!   yields bytes rather than a refusal, and no caller can tell. Reproduced
//!   here rather than fixed, because a check that refuses would turn ciphertext
//!   that opens today into an error.
//! * There is **no MAC**: CBC without authentication means whoever can write a
//!   ciphertext can steer the plaintext. Also the operator's call, not this
//!   port's.
//!
//! Existing ciphertext lives in `config.toml` and in the database, so a
//! different construction would not be a refactor — it would make every stored
//! secret undecryptable. The weakness is a finding to report, not a change to
//! make, and the reason this module reads as a transliteration is that it is
//! meant to.
//!
//! # Errors
//!
//! [`CryptoError`], whose text keeps the Python side's wording wherever the
//! Python side had a message: a caller switching a log line over should not
//! have to relearn what a refusal says.
//!
//! A wrong-length key is the one case given a different message. Python reports
//! it as "Wrong AES cryptogram length" from inside `decrypt_binary`, because
//! `AES.new` sits inside the `try` block that rewrites every `ValueError`; the
//! key length is what is actually wrong, and this port says so.

use std::fmt;

use aes::cipher::{Block, BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes128;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::RngExt;

use crate::auth::BcryptVerifier;
use crate::binary::{b64_to_bin, bin_to_hex, hex_to_bin, BinaryError};

/// Bytes in a key: 16, which makes the cipher AES-128.
pub const KEY_BYTES: usize = 16;

/// Bytes in an AES block, which is also the IV size and the padding unit.
pub const BLOCK_BYTES: usize = 16;

/// Letters in a generated password, as `generate_random_password` makes them.
pub const PASSWORD_LETTERS: usize = 6;

/// The bcrypt cost a stored password is hashed at (`crypto.py:58`).
pub const BCRYPT_ROUNDS: u32 = 12;

/// The most bytes bcrypt reads of a password; a longer one is refused, not cut.
pub const BCRYPT_MAX_PASSWORD_BYTES: usize = 72;

/// The method name a password is stored under in `admins.authentication`.
const BCRYPT_METHOD: &str = "bcrypt";

/// The method name that stores the secret itself, which nothing here will write.
const PLAINTEXT_METHOD: &str = "plaintext";

/// Why a secret operation was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    /// The key was not [`KEY_BYTES`] bytes of hexadecimal, which is 32 chars.
    KeyLength {
        /// How many hexadecimal characters were supplied.
        found: usize,
    },
    /// A character in the key was not a hex digit.
    KeyNotHex {
        /// The character that was refused.
        found: char,
    },
    /// The ciphertext was not the URL-safe base64 `encrypt_binary` writes.
    NotBase64,
    /// The decoded ciphertext had no IV, or a body that is not whole blocks.
    CryptogramLength {
        /// How many bytes were decoded, IV included.
        found: usize,
    },
    /// A number's plaintext was not hexadecimal, so there is no integer in it.
    NotANumber,
    /// `plaintext` was asked for, which would store the secret itself.
    PlaintextRefused,
    /// The method is neither `bcrypt` nor `plaintext`.
    UnknownMethod {
        /// The method that was found.
        method: String,
    },
    /// The payload handed to [`build_password`] was not a bcrypt hash, so
    /// wrapping it would store a raw password under a `bcrypt:` label.
    NotABcryptHash,
    /// The password is longer than bcrypt can store.
    PasswordTooLong {
        /// How many bytes the password was.
        bytes: usize,
    },
    /// The bcrypt implementation refused to hash, with its own reason.
    Hasher {
        /// What the implementation reported.
        reason: String,
    },
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::KeyLength { found } => write!(
                f,
                "key is {found} hexadecimal characters, expected {}",
                KEY_BYTES * 2
            ),
            Self::KeyNotHex { found } => {
                write!(f, "key character `{found}` is not a hex digit")
            }
            Self::NotBase64 => write!(f, "Could not decode from base64."),
            Self::CryptogramLength { found } => {
                write!(f, "Wrong AES cryptogram length: {found} bytes decoded")
            }
            Self::NotANumber => write!(f, "decrypted bytes are not a hexadecimal number"),
            Self::PlaintextRefused => write!(
                f,
                "Refusing to store a plaintext password: the stored value would be the user's \
                 secret, readable by anyone with database access, and plaintext rows are no \
                 longer accepted at login. Use bcrypt."
            ),
            Self::UnknownMethod { method } => {
                write!(f, "Authentication method not known: `{method}`")
            }
            Self::NotABcryptHash => write!(
                f,
                "The payload is not a bcrypt hash; build_password() only wraps an already-hashed \
                 password. Call hash_password() with the raw password instead."
            ),
            Self::PasswordTooLong { bytes } => write!(
                f,
                "Password is {bytes} bytes, over the {BCRYPT_MAX_PASSWORD_BYTES}-byte limit bcrypt \
                 can store; choose a shorter password."
            ),
            Self::Hasher { reason } => write!(f, "bcrypt refused to hash: {reason}"),
        }
    }
}

impl std::error::Error for CryptoError {}

/// Sixteen random bytes from the system's generator, for a key or an IV.
#[must_use]
pub fn get_random_key() -> [u8; KEY_BYTES] {
    let mut key = [0u8; KEY_BYTES];
    rand::rng().fill(&mut key);
    key
}

/// [`get_random_key`] in hexadecimal, which is the form `config.toml` holds.
#[must_use]
pub fn get_hex_random_key() -> String {
    bin_to_hex(&get_random_key())
}

/// A password of six lowercase letters, for a CLI that creates an account.
///
/// The letter count and the alphabet are what `generate_random_password` uses.
/// The generator is not: Python's is `random.choice`, the Mersenne Twister, and
/// a password drawn from it is predictable from a few hundred earlier draws.
/// Nothing stored depends on which generator produced a fresh password — it is
/// hashed the moment it exists — so this refuses to carry that predictability
/// across.
#[must_use]
pub fn generate_random_password() -> String {
    let mut rng = rand::rng();
    (0..PASSWORD_LETTERS)
        .map(|_| char::from(b'a' + rng.random_range(0..26u8)))
        .collect()
}

/// Encrypts `plaintext` under the key and answers the URL-safe string the
/// Python side would have written.
///
/// # Errors
///
/// [`CryptoError::KeyLength`] or [`CryptoError::KeyNotHex`] for a key that is
/// not 32 hexadecimal characters.
pub fn encrypt_binary(plaintext: &[u8], key_hex: &str) -> Result<String, CryptoError> {
    let key = key_from_hex(key_hex)?;
    Ok(seal(plaintext, &key, &get_random_key()))
}

/// Decrypts a string [`encrypt_binary`] produced, as the Python side produced it.
///
/// # Errors
///
/// [`CryptoError::NotBase64`] when the string is not the URL-safe base64 above,
/// [`CryptoError::CryptogramLength`] when it decodes to fewer than one IV or to
/// a body that is not whole blocks, and the two key variants for a bad key.
pub fn decrypt_binary(ciphertext: &str, key_hex: &str) -> Result<Vec<u8>, CryptoError> {
    let key = key_from_hex(key_hex)?;
    let escaped = ciphertext
        .replace('-', "+")
        .replace('_', "/")
        .replace('.', "=");
    let raw = b64_to_bin(&escaped).map_err(|_| CryptoError::NotBase64)?;
    // Python asks `AES.new` for `iv_ct[:16]` and hands the rest to `decrypt`,
    // so no IV at all, or a body that is not whole blocks, is the same refusal.
    if raw.len() < BLOCK_BYTES || !(raw.len() - BLOCK_BYTES).is_multiple_of(BLOCK_BYTES) {
        return Err(CryptoError::CryptogramLength { found: raw.len() });
    }
    Ok(open(&raw, &key))
}

/// Encrypts `num` as `b"%x" % num` did: lowercase hexadecimal, `-` when negative.
///
/// The bound is `i64` because the only numbers encrypted this way are row ids,
/// which the schema holds as 32- and 64-bit integers.
///
/// # Errors
///
/// The same two key variants as [`encrypt_binary`].
pub fn encrypt_number(num: i64, key_hex: &str) -> Result<String, CryptoError> {
    // `{:x}` on a signed integer prints its two's complement, so the sign has
    // to be written out the way `b"%x" % num` writes it: `-123` is `-7b`.
    let digits = if num < 0 {
        format!("-{:x}", num.unsigned_abs())
    } else {
        format!("{num:x}")
    };
    encrypt_binary(digits.as_bytes(), key_hex)
}

/// Decrypts a number [`encrypt_number`] encrypted.
///
/// # Errors
///
/// The same refusals as [`decrypt_binary`], and
/// [`CryptoError::NotANumber`] when the plaintext is not a hexadecimal integer.
pub fn decrypt_number(ciphertext: &str, key_hex: &str) -> Result<i64, CryptoError> {
    let plaintext = decrypt_binary(ciphertext, key_hex)?;
    let text = std::str::from_utf8(&plaintext).map_err(|_| CryptoError::NotANumber)?;
    i64::from_str_radix(text, 16).map_err(|_| CryptoError::NotANumber)
}

/// A stored authentication string from a payload that is already hashed.
///
/// This is the low-level half of [`hash_password`]: it stores no secret of its
/// own, it only tags a payload with the method that produced it.
///
/// # Errors
///
/// [`CryptoError::PlaintextRefused`] for the `plaintext` method, whose payload
/// would be the user's secret; [`CryptoError::UnknownMethod`] for any other
/// method; and [`CryptoError::NotABcryptHash`] for a payload that is not a
/// bcrypt hash, which a caller passing a raw password would otherwise get
/// stored verbatim under a `bcrypt:` label.
pub fn build_password(payload: &str, method: &str) -> Result<String, CryptoError> {
    match method {
        PLAINTEXT_METHOD => Err(CryptoError::PlaintextRefused),
        BCRYPT_METHOD => {
            if !is_bcrypt_hash(payload) {
                return Err(CryptoError::NotABcryptHash);
            }
            Ok(format!("{method}:{payload}"))
        }
        other => Err(CryptoError::UnknownMethod {
            method: other.to_string(),
        }),
    }
}

/// A raw password hashed and tagged, ready for `admins.authentication`.
///
/// # Errors
///
/// [`CryptoError::PlaintextRefused`] and [`CryptoError::UnknownMethod`] as
/// [`build_password`] reports them, [`CryptoError::PasswordTooLong`] for a
/// password over [`BCRYPT_MAX_PASSWORD_BYTES`], and [`CryptoError::Hasher`] when
/// bcrypt itself refuses.
pub fn hash_password(password: &str, method: &str) -> Result<String, CryptoError> {
    if method == PLAINTEXT_METHOD {
        return Err(CryptoError::PlaintextRefused);
    }
    if method != BCRYPT_METHOD {
        return Err(CryptoError::UnknownMethod {
            method: method.to_string(),
        });
    }
    let bytes = password.as_bytes();
    // bcrypt reads only 72 bytes, so a longer password is stored as its prefix
    // and every password sharing that prefix would authenticate.
    if bytes.len() > BCRYPT_MAX_PASSWORD_BYTES {
        return Err(CryptoError::PasswordTooLong { bytes: bytes.len() });
    }
    let payload = bcrypt::hash(bytes, BCRYPT_ROUNDS).map_err(|error| CryptoError::Hasher {
        reason: error.to_string(),
    })?;
    build_password(&payload, method)
}

/// The bcrypt check behind a [`PasswordForm::Bcrypt`](crate::PasswordForm).
///
/// The column's mapping deliberately owns no hash function, so this is the
/// implementation a caller passes in: it is here because [`hash_password`] is,
/// and a crate that can write a hash has to be able to read one back.
#[derive(Debug, Clone, Copy, Default)]
pub struct Bcrypt;

impl BcryptVerifier for Bcrypt {
    /// Whether `candidate` is the password `hash` was built from.
    ///
    /// A hash the implementation cannot parse is a wrong password rather than an
    /// error, as `bcrypt.checkpw` is caught and answered `false` in
    /// `validate_password`.
    fn verify(&self, candidate: &str, hash: &str) -> bool {
        bcrypt::verify(candidate.as_bytes(), hash).unwrap_or(false)
    }
}

/// The key bytes a 32-character hexadecimal string spells.
fn key_from_hex(key_hex: &str) -> Result<[u8; KEY_BYTES], CryptoError> {
    if key_hex.len() != KEY_BYTES * 2 {
        return Err(CryptoError::KeyLength {
            found: key_hex.len(),
        });
    }
    let bytes = hex_to_bin(key_hex).map_err(|error| match error {
        BinaryError::NotHex { found } => CryptoError::KeyNotHex { found },
        BinaryError::OddLength { found } => CryptoError::KeyLength { found },
        BinaryError::NotBase64 => CryptoError::KeyLength {
            found: key_hex.len(),
        },
    })?;
    let mut key = [0u8; KEY_BYTES];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// `iv || ciphertext`, base64'd and made URL-safe, for a known IV.
///
/// The IV is a parameter rather than a draw so the fixed-IV vectors captured
/// from the Python implementation can be reproduced byte for byte.
///
/// # Panics
///
/// Never: the key is [`KEY_BYTES`] bytes, which is the one length AES-128 takes.
fn seal(plaintext: &[u8], key: &[u8; KEY_BYTES], iv: &[u8; BLOCK_BYTES]) -> String {
    let padded = pad(plaintext);
    let cipher = Aes128::new_from_slice(key).expect("a 16-byte key fits AES-128");
    let mut sealed = Vec::with_capacity(BLOCK_BYTES + padded.len());
    sealed.extend_from_slice(iv);
    let mut chain = *iv;
    for block in padded.as_chunks::<BLOCK_BYTES>().0 {
        let mut current = [0u8; BLOCK_BYTES];
        for (index, byte) in current.iter_mut().enumerate() {
            *byte = block[index] ^ chain[index];
        }
        let mut array = Block::<Aes128>::default();
        array.copy_from_slice(&current);
        cipher.encrypt_block(&mut array);
        current.copy_from_slice(&array);
        sealed.extend_from_slice(&current);
        chain = current;
    }
    STANDARD
        .encode(&sealed)
        .replace('+', "-")
        .replace('/', "_")
        .replace('=', ".")
}

/// The plaintext of `iv || ciphertext`, padding stripped the way Python strips it.
fn open(sealed: &[u8], key: &[u8; KEY_BYTES]) -> Vec<u8> {
    let (iv, body) = sealed.split_at(BLOCK_BYTES);
    let cipher = Aes128::new_from_slice(key).expect("a 16-byte key fits AES-128");
    let mut plaintext = Vec::with_capacity(body.len());
    let mut chain = [0u8; BLOCK_BYTES];
    chain.copy_from_slice(iv);
    for block in body.as_chunks::<BLOCK_BYTES>().0 {
        let mut array = Block::<Aes128>::default();
        array.copy_from_slice(block);
        cipher.decrypt_block(&mut array);
        for (index, byte) in array.iter().enumerate() {
            plaintext.push(byte ^ chain[index]);
        }
        chain.copy_from_slice(block);
    }
    unpad(&plaintext)
}

/// The padding `encrypt_binary` adds: `0x01`, then `0x00` up to the next block.
///
/// Note the modulus: a plaintext whose length is `15 mod 16` gets a full block
/// of `0x00` after the `0x01`, so the padded length is always a multiple of 16
/// and is always strictly larger than the plaintext.
fn pad(plaintext: &[u8]) -> Vec<u8> {
    let zeros = BLOCK_BYTES - (plaintext.len() + 1) % BLOCK_BYTES;
    let mut padded = Vec::with_capacity(plaintext.len() + 1 + zeros);
    padded.extend_from_slice(plaintext);
    padded.push(0x01);
    padded.resize(padded.len() + zeros, 0x00);
    padded
}

/// Strips the padding the way `pt_pad.rstrip(b"\x00")[:-1]` does.
///
/// That is: drop every trailing `0x00`, then drop the one byte left at the end.
/// It is not a check — nothing verifies that a `0x01` was there — which is why
/// a wrong key answers bytes instead of an error. That silence is the Python
/// side's and is kept so ciphertext that opens today keeps opening.
///
/// A plaintext's own trailing `0x00` bytes do survive: they sit before the
/// `0x01`, which the strip stops at.
fn unpad(padded: &[u8]) -> Vec<u8> {
    let end = padded.iter().rposition(|&byte| byte != 0).unwrap_or(0);
    padded[..end].to_vec()
}

/// Whether `payload` has the shape `bcrypt.hashpw` returns.
///
/// `$2a$`, `$2b$`, `$2x$` and `$2y$` at cost 04..99, then the 53-character
/// salt-and-hash body. This is what tells an already-hashed payload from a raw
/// password handed to [`build_password`] by mistake.
fn is_bcrypt_hash(payload: &str) -> bool {
    let bytes = payload.as_bytes();
    if bytes.len() != 60 {
        return false;
    }
    let (prefix, body) = bytes.split_at(7);
    if prefix[0] != b'$'
        || prefix[1] != b'2'
        || !matches!(prefix[2], b'a' | b'b' | b'x' | b'y')
        || prefix[3] != b'$'
        || !prefix[4].is_ascii_digit()
        || !prefix[5].is_ascii_digit()
        || prefix[6] != b'$'
    {
        return false;
    }
    body.iter()
        .all(|byte| matches!(byte, b'.' | b'/' | b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The key every captured vector was made under: 16 zero bytes.
    const KEY_HEX: &str = "00000000000000000000000000000000";

    /// The IV the Python side drew, patched over `get_random_key` at capture time
    /// so that the ciphertext is a fixed value this test can compare against.
    const IV: [u8; BLOCK_BYTES] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10,
    ];

    /// `(plaintext length, ciphertext)` from `cmscommon.crypto.encrypt_binary`
    /// (Cryptodome 3.23.0): the padding boundary either side of 15, one block at
    /// 16, and past a block at 17 and 100.
    const CAPTURED: &[(usize, &str)] = &[
    (0, "AQIDBAUGBwgJCgsMDQ4PEGghXNHD1EAXy6YeEQd9lAc."),
    (1, "AQIDBAUGBwgJCgsMDQ4PEMd2Db3bxBPcBX9SG80BCTA."),
    (7, "AQIDBAUGBwgJCgsMDQ4PEJjxK5Jgk-2hJI8xNwmU51I."),
    (14, "AQIDBAUGBwgJCgsMDQ4PEHH054n23eBPOvOG7EGnKEY."),
    (15, "AQIDBAUGBwgJCgsMDQ4PEBSbtynjfzFySnJv1mpZCcQjQb7waW3QCNE77D88PCxY"),
    (16, "AQIDBAUGBwgJCgsMDQ4PECU1D3qMuUaUGjzZNYRGv5CFE9kcw-i0YqIDa_Wixset"),
    (17, "AQIDBAUGBwgJCgsMDQ4PECU1D3qMuUaUGjzZNYRGv5Apd8yKNxEn9YzZ6M7gFVUo"),
    (31, "AQIDBAUGBwgJCgsMDQ4PECU1D3qMuUaUGjzZNYRGv5AxKO-b8UuDy0SsPoaI388FtKBwTnC93qstMOXQqjygew.."),
    (32, "AQIDBAUGBwgJCgsMDQ4PECU1D3qMuUaUGjzZNYRGv5Cf9a2itw0npkA1Dn_0ksKr5MRty1UtHiuWttglnWElWw.."),
    (33, "AQIDBAUGBwgJCgsMDQ4PECU1D3qMuUaUGjzZNYRGv5Cf9a2itw0npkA1Dn_0ksKrmZ5PfcQs2H-6-EHJplyalg.."),
    (100, "AQIDBAUGBwgJCgsMDQ4PECU1D3qMuUaUGjzZNYRGv5Cf9a2itw0npkA1Dn_0ksKr3OYL-XvJkqRs1ROiuPHpTb-ZkcQS_eYiY4Ri2ohZfS8hXdXyJvnIzXHgHh9k7uAnzr0QOvO4796_V2ZZUPuTV7EshxpQKaZyxHg5lHZ9yrw."),
    ];

    /// The plaintext every vector was made from: `i % 251` for each index.
    fn plaintext(len: usize) -> Vec<u8> {
        (0..len).map(|index| (index % 251) as u8).collect()
    }

    #[test]
    fn the_cipher_reproduces_the_python_ciphertext_byte_for_byte() {
        let key = key_from_hex(KEY_HEX).expect("the test key is 32 hex characters");
        for (len, expected) in CAPTURED {
            let made = seal(&plaintext(*len), &key, &IV);
            assert_eq!(&made, expected, "encrypting {len} bytes");
            assert_eq!(open(&sealed_bytes(expected), &key), plaintext(*len));
        }
    }

    #[test]
    fn the_padding_always_lands_on_a_block_and_always_grows_the_plaintext() {
        for len in 0..64 {
            let padded = pad(&plaintext(len));
            assert_eq!(padded.len() % BLOCK_BYTES, 0, "padding {len} bytes");
            assert!(padded.len() > len, "padding {len} bytes");
            assert_eq!(padded[len], 0x01);
        }
    }

    #[test]
    fn the_strip_keeps_a_plaintexts_own_zero_bytes_and_refuses_nothing() {
        assert_eq!(unpad(&pad(b"abc\x00\x00")), b"abc\x00\x00");
        assert_eq!(unpad(&pad(b"")), b"");
        // What the missing check costs: a body that decrypts to anything at all
        // comes back as a plaintext, one byte shorter, with no refusal.
        assert_eq!(unpad(&[0xde, 0xad, 0x00, 0x00]), vec![0xde]);
        assert_eq!(unpad(&[0x00, 0x00]), Vec::<u8>::new());
    }

    #[test]
    fn a_key_that_is_not_thirty_two_hexadecimal_characters_is_refused() {
        assert_eq!(key_from_hex("00"), Err(CryptoError::KeyLength { found: 2 }));
        assert_eq!(
            key_from_hex("zz000000000000000000000000000000"),
            Err(CryptoError::KeyNotHex { found: 'z' })
        );
    }

    #[test]
    fn a_bcrypt_hash_is_told_from_a_raw_password_by_its_shape() {
        assert!(is_bcrypt_hash(
            "$2b$12$KIXQJ4wJ4oWl0Q1j5T7l0u4rWb1yW9mB0jVQ2eR8kUu3jD1xH0oPq"
        ));
        assert!(!is_bcrypt_hash("hunter2"));
        assert!(!is_bcrypt_hash(
            "$2b$12$KIXQJ4wJ4oWl0Q1j5T7l0u4rWb1yW9mB0jVQ2eR8kUu3jD1xH0oP"
        ));
    }

    /// The bytes a captured URL-safe base64 string spells.
    fn sealed_bytes(text: &str) -> Vec<u8> {
        let escaped = text.replace('-', "+").replace('_', "/").replace('.', "=");
        b64_to_bin(&escaped).expect("a captured vector is base64")
    }
}
