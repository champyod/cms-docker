//! Pascal, compiled with the system's Free Pascal.

use crate::tasktypes::Toolchain;

use super::words;

/// Pascal, as Free Pascal compiles it.
pub struct PascalFpc;

const SOURCES: &[&str] = &[".pas"];
/// A unit is found by a file ending in `lib.pas`, which is an extension with no
/// leading dot and so is spelled exactly as the reference spells it.
const HEADERS: &[&str] = &["lib.pas"];
const OBJECTS: &[&str] = &[".o"];
const COMPILER: &str = "/usr/bin/fpc";
/// Free Pascal's own spelling of the definition the GNU compilers write as -DEVAL.
const EVAL: &str = "-dEVAL";

impl Toolchain for PascalFpc {
    fn name(&self) -> &str {
        "Pascal / fpc"
    }

    fn source_extensions(&self) -> &[&str] {
        SOURCES
    }

    fn header_extensions(&self) -> &[&str] {
        HEADERS
    }

    fn object_extensions(&self) -> &[&str] {
        OBJECTS
    }

    fn compilation_commands(
        &self,
        sources: &[String],
        executable: &str,
        for_evaluation: bool,
    ) -> Vec<Vec<String>> {
        let mut command = words(&[COMPILER]);
        if for_evaluation {
            command.push(EVAL.to_owned());
        }
        command.extend(words(&["-O2", "-XSs"]));
        // One word, not two: fpc reads the output file only in this joined form.
        command.push(format!("-o{executable}"));
        // Only the file holding the program is compiled; fpc follows its uses.
        command.push(sources[0].clone());
        vec![command]
    }
}
