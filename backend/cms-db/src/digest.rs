//! File identity and file-cache handles.
//!
//! `fsobjects.digest` is the primary key of the table, and `cms.db.types` backs
//! it with a `DIGEST` domain over a check of `^([0-9a-f]{40}|x)$`: forty
//! lowercase hexadecimal digits, or the one-character tombstone that marks a
//! file whose content was dropped to recover space. The same digest is what
//! `cms.db.filecacher` keys its cache directory on, and what it refuses to read
//! or measure when it is the tombstone.
//!
//! Both types are newtypes over the same string with the domain's rule applied
//! once, so no caller can hold a digest the column would have rejected.
//!
//! The rest of the module is `src/cmscommon/digest.py` (75 lines):
//! [`Digester`], [`bytes_digest`] and [`path_digest`]. All three are SHA-1 —
//! `hashlib.sha1()`, not md5 and not sha512 — and they answer the same forty
//! lowercase hexadecimal characters the domain above admits, which is why a
//! digest computed here can be handed straight to [`FileDigest`].
//!
//! # Errors
//!
//! [`path_digest`] answers the `std::io::Error` of the read it performed and
//! nothing else: a file that cannot be opened has no digest, and reporting the
//! system's own failure keeps the path and the errno that name it.

use std::fmt;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::str::FromStr;

use sha1::{Digest, Sha1};

use crate::binary::bin_to_hex;

/// The value the `DIGEST` domain allows in place of a digest.
pub const TOMBSTONE: &str = "x";

/// Hexadecimal digits in a SHA-1 digest.
pub const DIGEST_HEX_LEN: usize = 40;

/// The step a file is read in, `io.DEFAULT_BUFFER_SIZE` on the Python side.
pub const DEFAULT_READ_BUFFER: usize = 8192;

/// Why a digest string was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DigestError {
    /// The string was empty, which no form of the domain allows.
    Empty,
    /// The string was not the tombstone and not forty characters.
    Length {
        /// How many characters were supplied.
        found: usize,
    },
    /// A character outside `0-9a-f` was present, including an uppercase one.
    NotLowercaseHex {
        /// The character that was refused.
        found: char,
    },
}

impl fmt::Display for DigestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "digest is empty"),
            Self::Length { found } => {
                write!(f, "digest is {found} characters, expected {DIGEST_HEX_LEN}")
            }
            Self::NotLowercaseHex { found } => {
                write!(f, "digest character `{found}` is not a lowercase hex digit")
            }
        }
    }
}

impl std::error::Error for DigestError {}

/// Why a file-cache request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheError {
    /// The handle names the tombstone, so there is no content to read.
    Tombstone,
}

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tombstone => write!(f, "digest is the tombstone and holds no content"),
        }
    }
}

impl std::error::Error for CacheError {}

/// What to do about a cache entry the caller wants gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoveAction {
    /// The handle names the tombstone, so there is nothing to remove.
    Skipped,
    /// The handle names a stored file, so the backend should be asked.
    Forward,
}

/// A stored file's identity: a SHA-1 digest, or the tombstone.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileDigest(String);

impl FileDigest {
    /// The tombstone, the one value that is not a digest of a file's content.
    #[must_use]
    pub fn tombstone() -> Self {
        Self(TOMBSTONE.to_string())
    }

    /// The digest as stored.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether this is the tombstone rather than a real digest.
    #[must_use]
    pub fn is_tombstone(&self) -> bool {
        self.0 == TOMBSTONE
    }
}

impl FromStr for FileDigest {
    type Err = DigestError;

    /// # Errors
    ///
    /// Returns [`DigestError`] unless the string is the tombstone or exactly
    /// forty characters drawn from `0-9a-f`. The domain's pattern is anchored
    /// and case-sensitive, so an uppercase digest is refused here rather than
    /// reaching a query that the column constraint would reject.
    fn from_str(text: &str) -> Result<Self, DigestError> {
        if text == TOMBSTONE {
            return Ok(Self(text.to_string()));
        }
        if text.is_empty() {
            return Err(DigestError::Empty);
        }
        let found = text.chars().count();
        if found != DIGEST_HEX_LEN {
            return Err(DigestError::Length { found });
        }
        text.chars()
            .find(|c| !c.is_ascii_hexdigit() || c.is_ascii_uppercase())
            .map_or_else(
                || Ok(Self(text.to_string())),
                |found| Err(DigestError::NotLowercaseHex { found }),
            )
    }
}

/// A request to the file cache, which refuses the tombstone.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CacheHandle {
    digest: FileDigest,
}

impl CacheHandle {
    /// A handle for a stored file or for the tombstone.
    #[must_use]
    pub const fn new(digest: FileDigest) -> Self {
        Self { digest }
    }

    /// The digest this handle names.
    #[must_use]
    pub const fn digest(&self) -> &FileDigest {
        &self.digest
    }

    /// Whether this handle names the tombstone.
    #[must_use]
    pub fn is_tombstone(&self) -> bool {
        self.digest.is_tombstone()
    }

    /// The digest to read content from.
    ///
    /// # Errors
    ///
    /// Returns [`CacheError::Tombstone`] for the tombstone, which
    /// `FileCacher.get_file` and `get_size` raise `TombstoneError` for rather
    /// than handing back a backend that would fail deeper in.
    pub fn open(&self) -> Result<&FileDigest, CacheError> {
        if self.digest.is_tombstone() {
            return Err(CacheError::Tombstone);
        }
        Ok(&self.digest)
    }

    /// Whether to forward a removal to the backend.
    ///
    /// `FileCacher.delete` and `drop` return early on the tombstone instead of
    /// calling the backend, so the caller must make the same choice here.
    #[must_use]
    pub fn remove(&self) -> RemoveAction {
        if self.digest.is_tombstone() {
            RemoveAction::Skipped
        } else {
            RemoveAction::Forward
        }
    }
}

/// A SHA-1 a caller feeds in pieces, as `cmscommon.digest.Digester` does.
///
/// `digest` leaves the state untouched, exactly as `hashlib`'s own `digest`
/// does, so one instance can be asked more than once while a value is still
/// being appended to it.
#[derive(Clone, Default)]
pub struct Digester {
    hasher: Sha1,
}

impl Digester {
    /// A digester with nothing fed to it yet.
    #[must_use]
    pub fn new() -> Self {
        Self {
            hasher: Sha1::new(),
        }
    }

    /// Feeds `bytes` in. Calling it twice is the same as feeding the join.
    pub fn update(&mut self, bytes: &[u8]) {
        self.hasher.update(bytes);
    }

    /// The digest of everything fed in so far, as lowercase hexadecimal.
    #[must_use]
    pub fn digest(&self) -> String {
        bin_to_hex(&self.hasher.clone().finalize())
    }
}

impl fmt::Debug for Digester {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Digester")
    }
}

/// The digest of `bytes`, as lowercase hexadecimal.
#[must_use]
pub fn bytes_digest(bytes: &[u8]) -> String {
    bin_to_hex(&Sha1::digest(bytes))
}

/// The digest of the content of the file at `path`, as lowercase hexadecimal.
///
/// The file is read in `io.DEFAULT_BUFFER_SIZE` steps because the Python side
/// reads it that way, which matters only for how much of a large file is held
/// at once: the digest of a file does not depend on the step.
///
/// # Errors
///
/// The `std::io::Error` of opening or reading the file.
pub fn path_digest(path: impl AsRef<Path>) -> io::Result<String> {
    let mut buffer = vec![0u8; DEFAULT_READ_BUFFER];
    let mut hasher = Sha1::new();
    let mut file = File::open(path)?;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(bin_to_hex(&hasher.finalize()))
}
