//! Named refusals for a worker result that cannot be mapped to an object write.

use std::fmt;

/// Why a worker result could not become an object write.
///
/// Each variant names the field that broke the mapping, so a caller can report
/// which part of the operation or the body needs attention. `NoWriteRequired`
/// is the one refusal that is not a defect: a tombstone flag with no tombstone
/// executable calls for no write at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MapError {
    /// The operation names a different submission than the inputs.
    WrongObjectId {
        /// The submission id the operation carried.
        operation: i64,
        /// The submission id the inputs were read for.
        inputs: i64,
    },
    /// The operation names a different dataset than the inputs.
    WrongDatasetId {
        /// The dataset id the operation carried.
        operation: i64,
        /// The dataset id the inputs were read for.
        inputs: i64,
    },
    /// The operation names no testcase for an evaluation.
    TestcaseRequired,
    /// No testcase of the dataset carries the operation's codename.
    MissingTestcase {
        /// The codename no testcase carried.
        codename: String,
    },
    /// More than one testcase of the dataset carries the operation's codename.
    DuplicateTestcase {
        /// The codename more than one testcase carried.
        codename: String,
    },
    /// The operation performs a user test rather than a submission.
    UnsupportedOperation {
        /// The operation type name the protocol carried.
        kind: &'static str,
    },
    /// A produced executable holds a digest the domain would refuse.
    BadExecutableDigest {
        /// The filename whose digest was refused.
        filename: String,
        /// The digest parser's own account of the refusal.
        detail: String,
    },
    /// A produced executable's filename violates the `FILENAME` domain.
    BadUserTestFilename {
        /// The filename the domain refused.
        filename: String,
        /// The filename parser's own account of the refusal.
        detail: String,
    },
    /// A tombstone flag has no matching tombstone executable to invalidate.
    NoWriteRequired,
}

impl fmt::Display for MapError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WrongObjectId { operation, inputs } => write!(
                formatter,
                "operation object_id {operation} does not match inputs submission {inputs}"
            ),
            Self::WrongDatasetId { operation, inputs } => write!(
                formatter,
                "operation dataset_id {operation} does not match inputs dataset {inputs}"
            ),
            Self::TestcaseRequired => write!(formatter, "evaluation has no testcase codename"),
            Self::MissingTestcase { codename } => {
                write!(formatter, "no testcase has codename `{codename}`")
            }
            Self::DuplicateTestcase { codename } => {
                write!(
                    formatter,
                    "more than one testcase has codename `{codename}`"
                )
            }
            Self::UnsupportedOperation { kind } => {
                write!(formatter, "unsupported operation type `{kind}`")
            }
            Self::BadExecutableDigest { filename, detail } => {
                write!(
                    formatter,
                    "executable `{filename}` digest is invalid: {detail}"
                )
            }
            Self::BadUserTestFilename { filename, detail } => write!(
                formatter,
                "user-test executable `{filename}` is invalid: {detail}"
            ),
            Self::NoWriteRequired => write!(formatter, "no write follows this tombstone result"),
        }
    }
}

impl std::error::Error for MapError {}
