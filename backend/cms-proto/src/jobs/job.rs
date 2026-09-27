//! One job of a batch, decoded against the key set of its own kind.
//!
//! The fields kept here are the ones the receiving service acts on after a
//! worker reports: which operation the result belongs to, whether the job
//! succeeded, the files the result has to store, and what the run measured. The
//! remaining keys are pinned — a job that does not carry every one of them is
//! refused — and are then read by the worker that produced them, not by the
//! service that files the result, so they are not typed here.

use serde_json::Value;

use super::keys::{DigestMap, JobKind};
use super::operation::{Operation, Shard};

/// A job of a finished batch, after its keys and values were checked.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedJob {
    /// Which of the two shapes the job had, and so which key set it passed.
    pub kind: JobKind,
    /// The operation the result is filed under, absent when the job carries none
    /// and so cannot be filed under anything.
    pub operation: Option<Operation>,
    /// Whether the worker reported the job as successful, which is what
    /// `action_finished` branches on before it adds a result.
    pub success: Option<bool>,
    /// The shard that ran the job, which must be the shard the call released.
    pub shard: Shard,
    /// Sandbox paths, which `action_finished` names when a job failed. A job
    /// carrying null has no sandbox rather than an unreadable one, because
    /// `Job.__init__` turns a null it is given into the empty list.
    pub sandboxes: Vec<String>,
    /// Files the user submitted, by name, as the digests the result stores.
    pub files: DigestMap,
    /// Managers the admins provided, by name, as digests.
    pub managers: DigestMap,
    /// Executables the compilation produced, by name, as digests.
    pub executables: DigestMap,
    /// Additional metadata, which both kinds carry and which is null when the
    /// task type wrote none.
    pub plus: Option<Value>,
    /// The field the kind adds on top of the nineteen keys the two shapes
    /// share.
    pub extras: KindExtras,
}

/// The fields each kind adds on top of the nineteen keys the two shapes share,
/// so a job carries exactly the metadata its own kind defines.
#[derive(Debug, Clone, PartialEq)]
pub enum KindExtras {
    /// The `compilation_success` key `CompilationJob.export_to_dict` adds.
    Compilation {
        /// Whether the compilation the job performed succeeded. Null when the
        /// task type never set it, as a user test that never compiled would.
        compilation_success: Option<bool>,
    },
    /// The eight execution-metadata keys `EvaluationJob.export_to_dict` adds.
    Evaluation(EvaluationOutcome),
}

/// What an evaluation run measured, the eight `EVALUATION_EXECUTION_KEYS`.
///
/// Every field is optional because the worker exports whatever the task type
/// set: a run that was not compared against a reference solution has no
/// outcome, and a run that did not fetch its output has no user output.
#[derive(Debug, Clone, PartialEq)]
pub struct EvaluationOutcome {
    /// Digest of the input file, null when none was fetched.
    pub input: Option<String>,
    /// Digest of the output file, null when none was fetched.
    pub output: Option<String>,
    /// User time limit in seconds, null when the job defined none.
    pub time_limit: Option<f64>,
    /// Memory limit in bytes, null when the job defined none. An integer,
    /// because `EvaluationJob.__init__` declares one over its `BigInteger`
    /// column, and a limit is stored as a whole number of mebibytes.
    pub memory_limit: Option<i64>,
    /// The outcome the score is computed from, null when the output was not
    /// compared against the reference solution.
    pub outcome: Option<String>,
    /// Digest of the file holding the output of the user program, null unless
    /// `get_output` asked for it.
    pub user_output: Option<String>,
    /// Whether only the execution was performed, without comparing the output.
    pub only_execution: Option<bool>,
    /// Whether the execution output was retrieved.
    pub get_output: Option<bool>,
}
