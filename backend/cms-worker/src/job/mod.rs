//! The four jobs a service sends a worker, one constructor for each.
//!
//! `Job.from_operation` is not one builder with four settings: it is four
//! constructors that disagree with each other, and the disagreements are the
//! behaviour. A submission compilation takes the dataset's managers as they
//! are. A user test compilation starts from the managers the test carries and
//! merges the task type's automatic ones over them, substitutes the language's
//! source extension into an automatic manager named `.%l`, and adds every
//! header the dataset holds. A submission evaluation names an output file and
//! leaves the two output flags unset; a user test evaluation names no output and
//! sets both. A language the lookup does not know stops a user test evaluation
//! and is passed over by a user test compilation.
//!
//! The four are written out one by one, each beginning with the same two
//! refusals, because a parity port earns its keep on the differences. The
//! submission paths live beside the shape they build, in `compilation` and
//! `evaluation`; the two user test paths sit together in `user_test`, where the
//! merge they share and the one thing each does differently read side by side.
//!
//! What a constructed job carries is what the service told it. The keys only the
//! worker fills in when it reports are not fields here, and the pinned key sets
//! in [`cms_proto::COMPILATION_KEYS`] and [`cms_proto::EVALUATION_KEYS`] remain
//! the whole of them.
//!
//! # Errors
//!
//! [`BuildError`], and only that: an operation naming another object or
//! dataset, a constructor handed an operation of another kind, a language the
//! lookup does not know on the one path that cannot pass over it, and the two
//! names the dataset is indexed by — a testcase and an automatic manager — when
//! the dataset holds neither.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod compilation;
mod evaluation;
mod user_test;

use std::collections::BTreeMap;
use std::fmt;

use serde_json::Value;

pub use cms_proto::{DigestMap, Operation, OperationKind};
pub use compilation::CompilationJob;
pub use evaluation::EvaluationJob;

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

/// Checks that the operation names the object and the dataset handed in.
///
/// `Job.from_operation` refuses before it dispatches on the operation, so a
/// result can never be built for one submission and filed under another. Every
/// constructor stands for the whole of that check, being reachable on its own.
///
/// # Errors
///
/// [`BuildError::ObjectMismatch`] and [`BuildError::DatasetMismatch`], each
/// naming the id the operation holds and the id it was given.
pub fn check_scope(
    operation: &Operation,
    object_id: i64,
    dataset_id: i64,
) -> Result<(), BuildError> {
    if operation.object_id != object_id {
        return Err(BuildError::ObjectMismatch {
            operation: operation.object_id,
            object: object_id,
        });
    }
    if operation.dataset_id != dataset_id {
        return Err(BuildError::DatasetMismatch {
            operation: operation.dataset_id,
            dataset: dataset_id,
        });
    }
    Ok(())
}

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
