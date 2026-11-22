//! The languages a worker was configured with, one implementation each.
//!
//! A language here is a [`Toolchain`]: the names its files go by and the two
//! command lists a job needs, and nothing else. There is one struct and one file
//! per language rather than a table read by an interpreter, because a table is a
//! second engine: it answers the questions its author thought of, and disagrees
//! with the real command the first time a language differs in the middle of its
//! argv — which Java, PHP and both Pythons all do.
//!
//! The lookup is the caller's half of the contract: the name a job carries is
//! turned into one of these by [`get_language`], a filename into the one language
//! whose extension it ends with, and a name this worker does not know is refused
//! rather than guessed.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod c11_gcc;
mod cpp11_gpp;
mod cpp14_gpp;
mod cpp17_gpp;
mod cpp20_gpp;
mod csharp_mono;
mod haskell_ghc;
mod java_jdk;
mod lookup;
mod pascal_fpc;
mod php;
mod python3_cpython;
mod python3_pypy;
mod rust;

pub use c11_gcc::C11Gcc;
pub use cpp11_gpp::Cpp11Gpp;
pub use cpp14_gpp::Cpp14Gpp;
pub use cpp17_gpp::Cpp17Gpp;
pub use cpp20_gpp::Cpp20Gpp;
pub use csharp_mono::CSharpMono;
pub use haskell_ghc::HaskellGhc;
pub use java_jdk::JavaJdk;
pub use lookup::{
    describe, filename_to_language, get_language, is_multithreaded, safe_get_lang_filename,
};
pub use pascal_fpc::PascalFpc;
pub use php::Php;
pub use python3_cpython::Python3Cpython;
pub use python3_pypy::Python3Pypy;
pub use rust::Rust;

use crate::tasktypes::Toolchain;

/// Every language this worker supports, which is the list a lookup searches.
pub const ALL: [&dyn Toolchain; 13] = [
    &C11Gcc,
    &Cpp11Gpp,
    &Cpp14Gpp,
    &Cpp17Gpp,
    &Cpp20Gpp,
    &CSharpMono,
    &HaskellGhc,
    &JavaJdk,
    &PascalFpc,
    &Php,
    &Python3Cpython,
    &Python3Pypy,
    &Rust,
];

/// One command line's worth of words, from the literals a language spells them as.
pub(super) fn words(items: &[&str]) -> Vec<String> {
    items.iter().map(|word| (*word).to_owned()).collect()
}
