//! The `FILENAME` and `FILENAME_SCHEMA` domains the user-test file columns use.
//!
//! `cms.db.types.Filename` (`src/cms/db/types.py:83-107`) accepts one or more
//! ASCII letters, digits, `_`, `-` or `.`, and refuses the two names that mean a
//! directory step; `FilenameSchema` (`types.py:119-145`) adds an optional `.%l`
//! suffix for a language-specific extension. A user test's input file is named
//! by a schema, because it is matched per language; the managers and executables
//! are named by a plain filename.
//!
//! Both domains compare bytes, so case is preserved. The alphabet is not widened
//! to Unicode: a name the database would refuse never reaches a query.

use std::fmt;
use std::str::FromStr;

/// The suffix a filename schema may carry in place of a language extension.
const LANGUAGE_PLACEHOLDER: &str = ".%l";

/// Why a value is not a filename.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum FilenameError {
    /// The name is empty before any language placeholder.
    #[error("a filename must not be empty")]
    Empty,
    /// The name is `.` or `..`, which UNIX reads as a directory step.
    #[error("a filename must not be `.` or `..`")]
    DirectoryEntry,
    /// The name holds a character outside the domain's alphabet.
    #[error("a filename may hold only ASCII letters, digits, `_`, `-` and `.`, not {character:?}")]
    ForbiddenCharacter {
        /// The first character the alphabet refuses.
        character: char,
    },
}

/// A `FILENAME` value.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Filename(String);

impl Filename {
    /// Applies the domain's alphabet and its two name refusals.
    ///
    /// # Errors
    ///
    /// [`FilenameError::Empty`] for an empty value, [`FilenameError::DirectoryEntry`]
    /// for `.` or `..`, and [`FilenameError::ForbiddenCharacter`] for the first
    /// character outside the alphabet.
    pub fn parse(value: &str) -> Result<Self, FilenameError> {
        check_base(value)?;
        Ok(Self(value.to_string()))
    }

    /// The name, exactly as the column stores it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A `FILENAME_SCHEMA` value: a filename with an optional `.%l` suffix.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FilenameSchema(String);

impl FilenameSchema {
    /// Applies the filename alphabet to the part before an optional `.%l`.
    ///
    /// The reference's check exempts the placeholder from the non-empty rule,
    /// so the part before it must still be a name; `.%l` alone has no base name
    /// and is refused.
    ///
    /// # Errors
    ///
    /// Returns [`FilenameError`] for a value whose base is empty, names a
    /// directory step, or holds a character outside the alphabet.
    pub fn parse(value: &str) -> Result<Self, FilenameError> {
        let base = value.strip_suffix(LANGUAGE_PLACEHOLDER).unwrap_or(value);
        check_base(base)?;
        Ok(Self(value.to_string()))
    }

    /// The schema, exactly as the column stores it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Filename {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Display for FilenameSchema {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for Filename {
    type Err = FilenameError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

impl FromStr for FilenameSchema {
    type Err = FilenameError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

/// The two refusals and the alphabet that apply to the base of either domain.
fn check_base(value: &str) -> Result<(), FilenameError> {
    if value.is_empty() {
        return Err(FilenameError::Empty);
    }
    if value == "." || value == ".." {
        return Err(FilenameError::DirectoryEntry);
    }
    if let Some(character) = value.chars().find(|character| !is_allowed(*character)) {
        return Err(FilenameError::ForbiddenCharacter { character });
    }
    Ok(())
}

/// The domain's character class, one character at a time.
const fn is_allowed(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-' || character == '.'
}
