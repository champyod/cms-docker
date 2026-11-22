//! Haskell, compiled with the system's ghc.

use std::path::Path;

use crate::tasktypes::Toolchain;

use super::words;

/// Haskell, as the ghc of the machine compiles it.
pub struct HaskellGhc;

const SOURCES: &[&str] = &[".hs"];
const OBJECTS: &[&str] = &[".o"];
const COMPILER: &str = "/usr/bin/ghc";
const LINK: &str = "/bin/ln";

impl Toolchain for HaskellGhc {
    fn name(&self) -> &str {
        "Haskell / ghc"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn object_extensions(&self) -> &[&str] {
        OBJECTS
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        _for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        let mut commands = Vec::new();
        // ghc finds a module by the file named after it, and module names start in upper case.
        for source in sources.iter().skip(1) {
            let mut link = words(&[LINK, "-s"]);
            link.push(basename(source));
            link.push(capitalised(source));
            commands.push(link);
        }
        // Only the file holding main is passed: ghc follows the imports itself.
        let mut compile = words(&[COMPILER, "-static", "-O2", "-Wall", "-o"]);
        compile.push(executable.to_owned());
        compile.push(sources[0].clone());
        commands.push(compile);
        commands
    }
}

/// The last component of a path, which is what a link in the current directory names.
fn basename(source: &str) -> String {
    Path::new(source)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

/// The same path with the first letter of its file name in upper case.
fn capitalised(source: &str) -> String {
    let name = basename(source);
    let Some(first) = name.chars().next() else {
        return source.to_owned();
    };
    let upper: String = first.to_uppercase().collect();
    Path::new(source)
        .with_file_name(format!("{upper}{}", &name[first.len_utf8()..]))
        .to_string_lossy()
        .into_owned()
}
