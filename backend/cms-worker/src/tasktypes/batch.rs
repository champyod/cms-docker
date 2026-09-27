//! The Batch task type: one program, judged by what it prints, and the failures
//! both of its phases report.
//!
//! The three parameters decide everything else, and each is read for what it
//! names and nothing more. The first says whether the submission is compiled by
//! itself or together with a grader the dataset holds; the second is a pair of
//! filenames, where an empty one is a redirect to the default file rather than a
//! file of its own; the third says whether the output is compared by a
//! comparator. A value that is neither of a choice's two names is the other one,
//! which is the decision `Batch.__init__` makes by equality with the two names.
//!
//! # Errors
//!
//! [`TaskError`], and only that. Every variant names the two things that disagree
//! or the file to look at, so a refusal says which manager, limit or count.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::path::Path;

use serde_json::Value;

use crate::sandbox::SpawnError;
use crate::stage::StageError;

/// The marker a codename carries where the language's own source extension goes,
/// and which the executable's name is built without.
pub(super) const SOURCE_PLACEHOLDER: &str = ".%l";
/// The basename of the grader, in the manager's filename and as the main class
/// in the languages that name one.
pub(super) const GRADER_BASENAME: &str = "grader";
/// The choice that compiles the submission together with a grader.
const COMPILATION_GRADER: &str = "grader";
/// The choice that has a comparator read the output rather than a plain diff.
const OUTPUT_EVAL_COMPARATOR: &str = "comparator";
/// The file a run is given as its input when the parameters name none.
const DEFAULT_INPUT_FILENAME: &str = "input.txt";
/// The file a run's answer is read from when the parameters name none.
const DEFAULT_OUTPUT_FILENAME: &str = "output.txt";

/// The Batch task type, as its three parameters say.
///
/// The parameters are held as they were given, and the two defaults are derived
/// from them rather than stored beside them, so there is one copy of each answer
/// and no way for the two to disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    compilation: String,
    input_filename: String,
    output_filename: String,
    output_eval: String,
}

/// Why a job was not compiled, not run, or not read back.
#[derive(Debug)]
pub enum TaskError {
    /// The task type parameters are not the three entries a Batch task has.
    Parameters,
    /// The dataset holds no manager of the name a grader compilation needs.
    MissingManager {
        /// The manager the compilation needs and the dataset does not hold.
        name: String,
    },
    /// The submission carries fewer files than a compilation is attempted for.
    TooFewFiles {
        /// How many files the submission carries.
        found: usize,
        /// How many are required.
        wanted: usize,
    },
    /// The result holds a number of executables an evaluation does not expect.
    UnexpectedExecutables {
        /// How many executables the result holds.
        found: usize,
        /// How many are expected.
        wanted: usize,
    },
    /// A limit the dataset set is not a positive number, and so bounds nothing.
    NonPositiveLimit {
        /// Which of the two limits was set to it.
        limit: &'static str,
        /// The value the dataset set.
        value: f64,
    },
    /// A file the run was to be handed could not be staged.
    Stage(StageError),
    /// A run could not be launched, or could not be read back once it had run.
    Spawn(SpawnError),
}

impl fmt::Display for TaskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parameters => {
                write!(
                    f,
                    "the task type parameters are not the three a Batch task has"
                )
            }
            Self::MissingManager { name } => {
                write!(f, "the dataset is missing manager `{name}`")
            }
            Self::TooFewFiles { found, wanted } => {
                write!(f, "the submission has {found} files, {wanted} are required")
            }
            Self::UnexpectedExecutables { found, wanted } => {
                write!(
                    f,
                    "the result has {found} executables, {wanted} are expected"
                )
            }
            Self::NonPositiveLimit { limit, value } => {
                write!(f, "the {limit} must be positive, is {value}")
            }
            Self::Stage(error) => write!(f, "{error}"),
            Self::Spawn(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for TaskError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Stage(error) => Some(error),
            Self::Spawn(error) => Some(error),
            _ => None,
        }
    }
}

impl From<StageError> for TaskError {
    fn from(error: StageError) -> Self {
        Self::Stage(error)
    }
}

impl From<SpawnError> for TaskError {
    fn from(error: SpawnError) -> Self {
        Self::Spawn(error)
    }
}

impl Batch {
    /// Reads the three parameters a Batch task type is configured with: the
    /// compilation choice, the pair of filenames, and the output-evaluation
    /// choice, in that order.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters hold exactly those three,
    /// with the middle one a pair of strings.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let entries = parameters.as_array().ok_or(TaskError::Parameters)?;
        let [compilation, names, output_eval] = entries.as_slice() else {
            return Err(TaskError::Parameters);
        };
        let names = names.as_array().ok_or(TaskError::Parameters)?;
        let [input, output] = names.as_slice() else {
            return Err(TaskError::Parameters);
        };
        Ok(Self {
            compilation: string_of(compilation)?,
            input_filename: string_of(input)?,
            output_filename: string_of(output)?,
            output_eval: string_of(output_eval)?,
        })
    }

    /// Whether the submission is compiled together with a grader.
    #[must_use]
    pub fn uses_grader(&self) -> bool {
        self.compilation == COMPILATION_GRADER
    }

    /// Whether a comparator reads the output rather than a plain diff.
    #[must_use]
    pub fn uses_comparator(&self) -> bool {
        self.output_eval == OUTPUT_EVAL_COMPARATOR
    }

    /// The file a run is given as its input: the name the parameters gave, or the
    /// default where they gave none. An empty name is not a file of its own, it is
    /// a redirect from this one.
    #[must_use]
    pub fn actual_input(&self) -> &str {
        named_or(&self.input_filename, DEFAULT_INPUT_FILENAME)
    }

    /// The file a run's answer is read from, read the same way as the input.
    #[must_use]
    pub fn actual_output(&self) -> &str {
        named_or(&self.output_filename, DEFAULT_OUTPUT_FILENAME)
    }

    /// The name the parameters gave for the answer, which is empty where the
    /// answer is a redirect. It is the name a report quotes when the run wrote
    /// somewhere other than it was told to.
    #[must_use]
    pub fn output_filename(&self) -> &str {
        &self.output_filename
    }

    /// Whether the run reads its input by redirect rather than opening a file.
    #[must_use]
    pub fn redirects_stdin(&self) -> bool {
        self.input_filename.is_empty()
    }

    /// Whether the run's answer is redirected rather than written by the run.
    #[must_use]
    pub fn redirects_stdout(&self) -> bool {
        self.output_filename.is_empty()
    }

    /// The name a run of `executable` is judged by: the grader's own basename,
    /// which is the main class in the languages that name one separately, and
    /// otherwise the executable's name without the extension it was given.
    #[must_use]
    pub fn main_of(&self, executable: &str) -> String {
        if self.uses_grader() {
            return GRADER_BASENAME.to_owned();
        }
        Path::new(executable)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    }
}

/// One parameter read as the string it has to be.
fn string_of(entry: &Value) -> Result<String, TaskError> {
    entry
        .as_str()
        .map(str::to_owned)
        .ok_or(TaskError::Parameters)
}

/// The name a parameter gave, or the default where it gave none.
fn named_or<'a>(name: &'a str, fallback: &'a str) -> &'a str {
    if name.is_empty() {
        fallback
    } else {
        name
    }
}
