//! The two spellings of bytes `cmscommon.binary` hands out: hexadecimal and
//! base64.
//!
//! Both are the whole of `src/cmscommon/binary.py` (41 lines), and both are
//! byte-for-byte what `binascii.b2a_hex`, `a2b_hex`, `b2a_base64(newline=False)`
//! and `a2b_base64` produce: lowercase hex with no prefix, and standard base64
//! with `=` padding and no line break. Nothing here re-encodes a value that is
//! already stored somewhere, so the only thing at stake is that a string this
//! module emits is the string the Python side wrote to the column.
//!
//! # Errors
//!
//! [`BinaryError`], and only that: hex of an odd length, a character no hex
//! digit, and a base64 string the standard alphabet cannot decode. Python
//! raises `binascii.Error` for the same three, and the ciphertext decoder in
//! [`crate::crypto`] turns the last one into its own refusal.

use std::fmt;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// Why a hex or base64 string was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryError {
    /// The string had an odd number of characters, so it cannot pair into bytes.
    OddLength {
        /// How many characters were supplied.
        found: usize,
    },
    /// A character outside `0-9a-fA-F`, which `binascii.a2b_hex` also refuses.
    NotHex {
        /// The character that was refused.
        found: char,
    },
    /// A base64 string the standard alphabet does not decode, including one
    /// whose padding is missing.
    NotBase64,
}

impl fmt::Display for BinaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OddLength { found } => {
                write!(f, "hex string is {found} characters, which is not even")
            }
            Self::NotHex { found } => write!(f, "`{found}` is not a hex digit"),
            Self::NotBase64 => write!(f, "not a base64 string"),
        }
    }
}

impl std::error::Error for BinaryError {}

/// The bytes as lowercase hexadecimal, two characters to a byte.
#[must_use]
pub fn bin_to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

/// The bytes a hexadecimal string spells.
///
/// Uppercase digits are accepted, as `binascii.a2b_hex` accepts them.
///
/// # Errors
///
/// [`BinaryError::OddLength`] for an odd number of characters,
/// [`BinaryError::NotHex`] for a character no hex digit.
pub fn hex_to_bin(text: &str) -> Result<Vec<u8>, BinaryError> {
    if !text.len().is_multiple_of(2) {
        return Err(BinaryError::OddLength { found: text.len() });
    }
    let digits = text.as_bytes();
    let mut bytes = Vec::with_capacity(digits.len() / 2);
    for pair in digits.as_chunks::<2>().0 {
        let high = hex_digit(pair[0])?;
        let low = hex_digit(pair[1])?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

/// The bytes as standard base64, padded with `=` and with no line break.
#[must_use]
pub fn bin_to_b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

/// The bytes a standard base64 string spells.
///
/// # Errors
///
/// [`BinaryError::NotBase64`] for anything the standard alphabet does not
/// decode. Python's decoder is lenient about stray characters and missing
/// padding; this one is not, so the difference shows only on input that a
/// decoder was already being handed as damaged.
pub fn b64_to_bin(text: &str) -> Result<Vec<u8>, BinaryError> {
    STANDARD.decode(text).map_err(|_| BinaryError::NotBase64)
}

/// The value of one hexadecimal digit, either case.
fn hex_digit(byte: u8) -> Result<u8, BinaryError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        other => Err(BinaryError::NotHex {
            found: char::from(other),
        }),
    }
}
