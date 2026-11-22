//! Hex, base64 and SHA-1: the values `cmscommon.binary` and `cmscommon.digest`
//! produce, against the strings the Python implementation produced for the same
//! input.
//!
//! Each constant here was printed by `cmscommon.binary`/`cmscommon.digest` in
//! `ghcr.io/champyod/cms-docker-core:major-admin-panel`, run over this lane's
//! `src/`. The one exception is the file digest, which is checked against a
//! digest of the same bytes computed in memory — that is the property
//! `path_digest` exists for.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use cms_db::{
    b64_to_bin, bin_to_b64, bin_to_hex, bytes_digest, hex_to_bin, path_digest, BinaryError,
    Digester,
};

/// A digest nothing here has stored, and one the Python side gave for `""`.
const SHA1_EMPTY: &str = "da39a3ee5e6b4b0d3255bfef95601890afd80709";

/// `bytes_digest(b"stuff")`, and `bytes_digest(b"abc")`.
const SHA1_STUFF: &str = "5eee38381388b6f30efdd5c5c6f067dbf32c0bb3";
const SHA1_ABC: &str = "a9993e364706816aba3e25717850c26c9cd0d89d";

/// `bytes_digest` of the 20 000-byte pattern the file test writes, which is more
/// than the 8 192-byte read step twice over.
const SHA1_PATTERN: &str = "7f21d0bec0ec41aea43854e5bb9e97951d383157";

/// Bytes in the pattern the file test writes.
const PATTERN_LEN: usize = 20_000;

/// What one test's file is named apart by.
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A file of its own under the system temporary directory, removed at the end.
struct Scratch {
    path: PathBuf,
}

impl Scratch {
    /// An empty file no other test is using.
    fn new(label: &str) -> Self {
        let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let name = format!("cms-digest-{label}-{}-{sequence}", std::process::id());
        let path = std::env::temp_dir().join(name);
        Self { path }
    }

    /// The path the file is at.
    fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Fills the file with `content`.
    fn write(&self, content: &[u8]) {
        let mut file = fs::File::create(&self.path).expect("the file is the test's own");
        file.write_all(content)
            .expect("a fresh file accepts a write");
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// `i % 251` for every index, which is the pattern the digest constants cover.
fn pattern(len: usize) -> Vec<u8> {
    (0..len).map(|index| (index % 251) as u8).collect()
}

#[test]
fn hexadecimal_is_lowercase_and_two_characters_to_a_byte() {
    assert_eq!(bin_to_hex(b""), "");
    assert_eq!(bin_to_hex(b"\x00\xff"), "00ff");
    assert_eq!(bin_to_hex(b"stuff"), "7374756666");
    assert_eq!(bin_to_hex(&pattern(256)).len(), 512);
}

#[test]
fn hexadecimal_reads_back_either_case() {
    assert_eq!(
        hex_to_bin("00ff").expect("lowercase spells bytes"),
        b"\x00\xff"
    );
    assert_eq!(
        hex_to_bin("00FF").expect("uppercase spells the same bytes"),
        b"\x00\xff"
    );
    assert_eq!(
        hex_to_bin("").expect("an empty string spells no bytes"),
        b""
    );
    for len in 0..64 {
        let value = pattern(len);
        assert_eq!(
            hex_to_bin(&bin_to_hex(&value)).expect("its own hex reads back"),
            value
        );
    }
}

#[test]
fn a_hexadecimal_string_of_odd_length_is_refused() {
    assert_eq!(hex_to_bin("0"), Err(BinaryError::OddLength { found: 1 }));
    assert_eq!(hex_to_bin("000"), Err(BinaryError::OddLength { found: 3 }));
}

#[test]
fn a_character_that_is_not_a_hex_digit_is_refused() {
    assert_eq!(hex_to_bin("0g"), Err(BinaryError::NotHex { found: 'g' }));
    assert_eq!(hex_to_bin("0 "), Err(BinaryError::NotHex { found: ' ' }));
}

#[test]
fn base64_is_the_standard_alphabet_with_padding_and_no_line_break() {
    assert_eq!(bin_to_b64(b""), "");
    assert_eq!(bin_to_b64(b"\x00\xff"), "AP8=");
    // The three padding cases, which is where a base64 alphabet is easy to get
    // wrong: one byte keeps `==`, two keep `=`, three keep neither.
    assert_eq!(bin_to_b64(&[0x00]), "AA==");
    assert_eq!(bin_to_b64(&[0x00, 0x00]), "AAA=");
    assert_eq!(bin_to_b64(&[0x00, 0x00, 0x00]), "AAAA");
    assert_eq!(bin_to_b64(b"stuff"), "c3R1ZmY=");
    assert!(!bin_to_b64(&pattern(100)).contains('\n'));
}

#[test]
fn base64_reads_back_what_it_wrote() {
    for len in 0..64 {
        let value = pattern(len);
        assert_eq!(
            b64_to_bin(&bin_to_b64(&value)).expect("its own base64 reads back"),
            value
        );
    }
}

#[test]
fn a_string_that_is_not_base64_is_refused() {
    assert_eq!(b64_to_bin("not base64!"), Err(BinaryError::NotBase64));
    assert_eq!(b64_to_bin("A"), Err(BinaryError::NotBase64));
}

#[test]
fn the_digest_is_sha1_of_the_bytes() {
    assert_eq!(bytes_digest(b""), SHA1_EMPTY);
    assert_eq!(bytes_digest(b"stuff"), SHA1_STUFF);
    assert_eq!(bytes_digest(b"abc"), SHA1_ABC);
    assert_eq!(bytes_digest(&pattern(PATTERN_LEN)), SHA1_PATTERN);
}

#[test]
fn a_digester_fed_in_pieces_gives_the_digest_of_the_join() {
    let mut digester = Digester::new();
    digester.update(b"stu");
    digester.update(b"ff");
    assert_eq!(digester.digest(), SHA1_STUFF);
    // `hashlib`'s own `digest` does not consume the state, so neither does this.
    digester.update(b"!");
    assert_eq!(digester.digest(), bytes_digest(b"stuff!"));
}

#[test]
fn a_files_digest_is_the_digest_of_its_content() {
    let scratch = Scratch::new("pattern");
    scratch.write(&pattern(PATTERN_LEN));
    assert_eq!(
        path_digest(scratch.path()).expect("a written file has a digest"),
        SHA1_PATTERN
    );
}

#[test]
fn a_file_that_is_not_there_has_no_digest() {
    let scratch = Scratch::new("absent");
    assert!(path_digest(scratch.path()).is_err());
}
