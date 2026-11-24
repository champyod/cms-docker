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
//! What a job is built from is `model`: the dataset, the submission and the user
//! test, and why one of them was not built. What a constructed job carries is
//! what the service told it, so the keys only the worker fills in when it reports
//! are not fields here, and the pinned key sets in [`cms_proto::COMPILATION_KEYS`]
//! and [`cms_proto::EVALUATION_KEYS`] remain the whole of them.
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
mod model;
mod user_test;
pub mod wire;

pub use cms_proto::{DigestMap, Operation, OperationKind};
pub use compilation::CompilationJob;
pub use evaluation::EvaluationJob;
pub use model::{BuildError, Dataset, Language, Submission, Testcase, UserTest};

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
