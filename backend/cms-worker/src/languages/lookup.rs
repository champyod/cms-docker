//! What a name a job carries means, and what a file name belongs to.
//!
//! The worker is configured with the languages it has, so a name it does not know
//! is refused here rather than guessed at: a job naming `C++` when the worker
//! supports `C++17 / g++` is a contest configured against another worker's list,
//! and compiling it with the nearest language would judge a submission the
//! contestant did not write.

use crate::job::{BuildError, Language};
use crate::tasktypes::Toolchain;

use super::ALL;

/// What an unknown language stands in for, so a file name says it was not resolved
/// rather than looking like a language the worker does have.
const UNKNOWN: &str = ".invalid_language";
/// Where a filename template asks for the language's extension.
const PLACEHOLDER: &str = ".%l";

/// The language a job names.
///
/// # Errors
///
/// [`BuildError::UnknownLanguage`] when the name is not one this worker has.
pub fn get_language(name: &str) -> Result<&'static dyn Toolchain, BuildError> {
    ALL.iter()
        .copied()
        .find(|language| language.name() == name)
        .ok_or_else(|| BuildError::UnknownLanguage {
            language: Some(name.to_owned()),
        })
}

/// The one language a filename belongs to, or none when no source extension matches.
///
/// Ties are broken by name, in the order the reference breaks them: both Pythons
/// take `.py`, and CPython is the one a filename is read as.
pub fn filename_to_language(filename: &str) -> Option<&'static dyn Toolchain> {
    let extension = &filename[filename.rfind('.')?..];
    let mut matching: Vec<&'static dyn Toolchain> = ALL
        .iter()
        .copied()
        .filter(|language| language.source_extensions().contains(&extension))
        .collect();
    matching.sort_by(|left, right| left.name().cmp(right.name()));
    matching.first().copied()
}

/// A filename template with the language's source extension in place of `.%l`.
///
/// A name this worker does not know substitutes [`UNKNOWN`] and is not an error:
/// this names a file rather than starting a job, and the reference's answer is a
/// file a reader can see was not resolved.
pub fn safe_get_lang_filename(language: Option<&str>, filename: &str) -> String {
    let Some(name) = language else {
        return filename.to_owned();
    };
    let extension = get_language(name).map_or(UNKNOWN, |language| language.source_extension());
    filename.replace(PLACEHOLDER, extension)
}

/// Whether a contest needs a multithreaded sandbox: any language it allows does.
///
/// A name that is not one of ours cannot need one and is not refused here, because
/// this is asked about a whole contest rather than about the job being built.
pub fn is_multithreaded(names: &[&str]) -> bool {
    names
        .iter()
        .any(|name| get_language(name).is_ok_and(|language| language.requires_multithreading()))
}

/// What a language contributes to a job, or none when the name is not one of ours.
pub fn describe(name: &str) -> Option<Language> {
    let language = get_language(name).ok()?;
    Some(Language {
        source_extension: language.source_extension().to_owned(),
        header_extensions: owned(language.header_extensions()),
        object_extensions: owned(language.object_extensions()),
        requires_multithreading: language.requires_multithreading(),
    })
}

/// A language's extension list as the descriptor holds it.
fn owned(extensions: &[&str]) -> Vec<String> {
    extensions
        .iter()
        .map(|extension| (*extension).to_owned())
        .collect()
}
