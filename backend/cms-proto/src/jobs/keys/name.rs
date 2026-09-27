//! The name of a key this crate claims, in a type that cannot hold a name it
//! does not.
//!
//! A key name is written down as a plain literal in every reader that wants one,
//! and a literal compiles whether or not the job shape that set it has. The
//! constant list below is what this crate actually reads, so a name that reached
//! a reader by any other route is refused here instead of being read as a field
//! that was never there.

use crate::jobs::refusal::JobError;

/// A key name the Python side writes and this crate reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct JobKey(&'static str);

impl JobKey {
    /// The key naming the operation the result is filed under.
    pub const OPERATION: Self = Self("operation");

    /// The key whose value names the operation kind.
    pub const TYPE: Self = Self("type");

    /// The key naming the submission or user test the operation is for.
    pub const OBJECT_ID: Self = Self("object_id");

    /// The key naming the dataset the operation runs against.
    pub const DATASET_ID: Self = Self("dataset_id");

    /// The key naming the one testcase an evaluation runs.
    pub const TESTCASE_CODENAME: Self = Self("testcase_codename");

    /// The key reporting whether the sandbox is archived.
    pub const ARCHIVE_SANDBOX: Self = Self("archive_sandbox");

    /// The key the worker stamps with the index that ran the job.
    pub const SHARD: Self = Self("shard");

    /// The key holding the sandbox paths of a failed job.
    pub const SANDBOXES: Self = Self("sandboxes");

    /// The key reporting whether the job succeeded.
    pub const SUCCESS: Self = Self("success");

    /// The key holding the submitted files by digest.
    pub const FILES: Self = Self("files");

    /// The key holding the manager files by digest.
    pub const MANAGERS: Self = Self("managers");

    /// The key holding the produced executables by digest.
    pub const EXECUTABLES: Self = Self("executables");

    /// The key holding the metadata the task type wrote.
    pub const PLUS: Self = Self("plus");

    /// The key a compilation job adds for its own outcome.
    pub const COMPILATION_SUCCESS: Self = Self("compilation_success");

    /// The key holding the fetched input digest.
    pub const INPUT: Self = Self("input");

    /// The key holding the fetched output digest.
    pub const OUTPUT: Self = Self("output");

    /// The key holding the user time limit.
    pub const TIME_LIMIT: Self = Self("time_limit");

    /// The key holding the memory limit.
    pub const MEMORY_LIMIT: Self = Self("memory_limit");

    /// The key holding the outcome the score is computed from.
    pub const OUTCOME: Self = Self("outcome");

    /// The key holding the digest of the user program's output file.
    pub const USER_OUTPUT: Self = Self("user_output");

    /// The key reporting whether only the execution was performed.
    pub const ONLY_EXECUTION: Self = Self("only_execution");

    /// The key reporting whether the execution output was retrieved.
    pub const GET_OUTPUT: Self = Self("get_output");

    /// Reads a key name off the wire, refusing one this crate does not claim.
    ///
    /// The empty name is refused by the same arm as any other unclaimed one: no
    /// key set on either side contains it, so a message carrying it is not a
    /// message either implementation wrote.
    ///
    /// # Errors
    ///
    /// Returns [`JobError::UnknownKey`] naming the name for a string no
    /// constant above carries, the empty string included.
    pub fn new(name: &str) -> Result<Self, JobError> {
        match name {
            "operation" => Ok(Self::OPERATION),
            "type" => Ok(Self::TYPE),
            "object_id" => Ok(Self::OBJECT_ID),
            "dataset_id" => Ok(Self::DATASET_ID),
            "testcase_codename" => Ok(Self::TESTCASE_CODENAME),
            "archive_sandbox" => Ok(Self::ARCHIVE_SANDBOX),
            "shard" => Ok(Self::SHARD),
            "sandboxes" => Ok(Self::SANDBOXES),
            "success" => Ok(Self::SUCCESS),
            "files" => Ok(Self::FILES),
            "managers" => Ok(Self::MANAGERS),
            "executables" => Ok(Self::EXECUTABLES),
            "plus" => Ok(Self::PLUS),
            "compilation_success" => Ok(Self::COMPILATION_SUCCESS),
            "input" => Ok(Self::INPUT),
            "output" => Ok(Self::OUTPUT),
            "time_limit" => Ok(Self::TIME_LIMIT),
            "memory_limit" => Ok(Self::MEMORY_LIMIT),
            "outcome" => Ok(Self::OUTCOME),
            "user_output" => Ok(Self::USER_OUTPUT),
            "only_execution" => Ok(Self::ONLY_EXECUTION),
            "get_output" => Ok(Self::GET_OUTPUT),
            unclaimed => Err(JobError::UnknownKey {
                key: unclaimed.to_owned(),
            }),
        }
    }

    /// The name as the Python side writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        self.0
    }
}
