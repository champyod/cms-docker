//! What a job is built from, and why one of them was not built.
//!
//! Every type here is a value the service hands a constructor: the dataset the
//! operation is checked against, the submission or user test it is built for, and
//! the entries each of those is read by. [`BuildError`] is the other half — the
//! disagreement or the missing entry that stopped the construction — so a refusal
//! names the id or the name to look at rather than reporting a value that was not
//! right.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::fmt;

use serde_json::Value;

use cms_proto::{DigestMap, OperationKind};

/// Why one job was not built.
///
/// Every variant names the two things that disagree or the thing that is
/// missing, so a refused construction says which id or which name to look at
/// instead of reporting that a value was not right.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BuildError {
    /// The operation is for an object other than the one handed in.
    ObjectMismatch {
        /// Object the operation names.
        operation: i64,
        /// Object the constructor was given.
        object: i64,
    },
    /// The operation is for a dataset other than the one handed in.
    DatasetMismatch {
        /// Dataset the operation names.
        operation: i64,
        /// Dataset the constructor was given.
        dataset: i64,
    },
    /// The operation is not the one this constructor builds a job for.
    UnexpectedOperation {
        /// Operation the constructor stands for.
        wanted: OperationKind,
        /// Operation it was handed.
        found: OperationKind,
    },
    /// The language of a user test names no known language, on the one path that
    /// reads what the lookup returned.
    UnknownLanguage {
        /// Name the test was submitted under, absent when it was submitted
        /// under none at all.
        language: Option<String>,
    },
    /// The dataset holds no testcase the operation names, or the operation
    /// named none at all.
    UnknownTestcase {
        /// Codename the operation names, absent when it named none.
        codename: Option<String>,
    },
    /// The dataset holds no manager an automatic manager list names.
    UnknownManager {
        /// Manager name the task type asked for, after the substitution.
        name: String,
    },
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ObjectMismatch { operation, object } => write!(
                f,
                "Object mismatch while building job: operation names object {operation}, object given is {object}."
            ),
            Self::DatasetMismatch { operation, dataset } => write!(
                f,
                "Dataset mismatch while building job: operation names dataset {operation}, dataset given is {dataset}."
            ),
            Self::UnexpectedOperation { wanted, found } => {
                write!(f, "Operation {found:?} is not the {wanted:?} this constructor builds.")
            }
            Self::UnknownLanguage { language } => match language {
                Some(name) => write!(f, "Unknown language `{name}`."),
                None => write!(f, "The user test was submitted under no language."),
            },
            Self::UnknownTestcase { codename } => match codename {
                Some(name) => write!(f, "The dataset holds no testcase named `{name}`."),
                None => write!(f, "The operation names no testcase to evaluate."),
            },
            Self::UnknownManager { name } => {
                write!(f, "The dataset holds no manager named `{name}`.")
            }
        }
    }
}

impl std::error::Error for BuildError {}

/// What a language's entry contributes to the managers a job carries.
///
/// The lookup is the caller's: `cms.grading.languagemanager.get_language` reads
/// the configured languages, and a name it does not know has no entry here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Language {
    /// Extension a source file of this language has, which is what an automatic
    /// manager named `.%l` is renamed to.
    pub source_extension: String,
    /// Extensions of the header files the language reads, each of which makes a
    /// manager of the dataset one this language has to be given.
    pub header_extensions: Vec<String>,
    /// Extensions of the object files the language reads, which a manager may
    /// arrive as instead of a source or a header.
    pub object_extensions: Vec<String>,
    /// Whether the language needs more than one thread, which is what makes the
    /// contest's sandbox multithreaded and every run in it permitted to fork.
    pub requires_multithreading: bool,
}

/// One testcase of a dataset: what a submission evaluation is run against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Testcase {
    /// `testcases.codename`, the name the operation's testcase is addressed by.
    pub codename: String,
    /// `testcases.input`, the digest of the input file.
    pub input: String,
    /// `testcases.output`, the digest of the output file.
    pub output: String,
}

/// The dataset a job is built against, as the four constructors read it.
#[derive(Debug, Clone, PartialEq)]
pub struct Dataset {
    /// `datasets.id`, the id the operation names.
    pub id: i64,
    /// `datasets.task_type`, the name of the task type that judges it.
    pub task_type: String,
    /// `datasets.task_type_parameters`, opaque to everything but the task type.
    pub task_type_parameters: Value,
    /// `dataset.managers`, the managers the admins provided, by name.
    pub managers: DigestMap,
    /// What the task type's `get_auto_managers` answers, which decides whether
    /// the managers a job takes are the whole set or the ones named here.
    pub auto_managers: Option<Vec<String>>,
    /// `dataset.testcases`, by codename; a submission evaluation takes the one
    /// its operation names out of it.
    pub testcases: BTreeMap<String, Testcase>,
    /// `datasets.time_limit` in seconds, absent when the dataset sets none.
    pub time_limit: Option<f64>,
    /// `datasets.memory_limit` in bytes, absent when the dataset sets none.
    pub memory_limit: Option<i64>,
}

/// The submission a job is built for, as the two submission paths read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submission {
    /// `submissions.id`, the id the operation names.
    pub id: i64,
    /// `submissions.language`, absent when the task takes no language.
    pub language: Option<String>,
    /// What the language lookup returned for that name, absent when the name is
    /// absent or names no known language.
    pub language_descriptor: Option<Language>,
    /// `submission.files`, by name, as digests.
    pub files: DigestMap,
    /// The executables the submission's result for the dataset holds, which
    /// only the evaluation path reads.
    pub result_executables: DigestMap,
    /// Whether the contest's languages need a multithreaded sandbox, which
    /// `_is_contest_multithreaded` answers and the caller has already done.
    pub multithreaded_sandbox: bool,
}

/// The user test a job is built for, as the two user test paths read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTest {
    /// `user_tests.id`, the id the operation names.
    pub id: i64,
    /// `user_tests.language`, the name the test was submitted under.
    pub language: Option<String>,
    /// What the language lookup returned for that name, absent when the name is
    /// absent or names no known language.
    pub language_descriptor: Option<Language>,
    /// `user_test_files`, by name, as digests.
    pub files: DigestMap,
    /// `user_tests.managers`, the managers the test itself carries, which the
    /// automatic managers are merged over.
    pub managers: DigestMap,
    /// `user_tests.input`, the digest of the file the test is run with.
    pub input: String,
    /// The executables the user test's result for the dataset holds, which only
    /// the evaluation path reads.
    pub result_executables: DigestMap,
    /// Whether the contest's languages need a multithreaded sandbox, as
    /// [`Submission::multithreaded_sandbox`].
    pub multithreaded_sandbox: bool,
}
