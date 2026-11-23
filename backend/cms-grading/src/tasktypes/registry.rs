//! The task type a task row's `task_type` column names.
//!
//! The reference builds one dictionary from each task type's class name and looks the
//! column's value up in it (`tasktypes/__init__.py:48`), so the key is the class name —
//! never the human label the same class also publishes. The two disagree for `OutputOnly`
//! and `TwoSteps`, whose labels read `Output only` and `Two steps`: a lookup keyed on the
//! label would refuse every task of those two kinds while saying the type does not exist.
//!
//! The reference answers a name it does not hold with a bare `KeyError`; [`TaskType::of`]
//! names the key instead, which is a deliberate divergence so an operator can find the row.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use serde_json::Value;

use super::{Batch, BatchAndOutput, Communication, OutputOnly, TaskError, TwoSteps};

/// One of the five task types, built from the parameters its task row carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskType {
    /// A submission that is one program, judged by what it prints.
    Batch(Batch),
    /// Testcases answered either by a carried answer or by a run.
    BatchAndOutput(BatchAndOutput),
    /// A submission that is a list of answers rather than a program.
    OutputOnly(OutputOnly),
    /// A submission whose manager computes and then recovers an answer.
    TwoSteps(TwoSteps),
    /// A submission run as several processes against a stub.
    Communication(Communication),
}

impl TaskType {
    /// The task type the `task_type` column names, or a refusal naming it.
    ///
    /// `key` is the registry key, the class name the reference files the type under, and
    /// not the human label [`Self::label`] answers: accepting a label here would refuse
    /// every `OutputOnly` and `TwoSteps` task a database holds. The parameters are handed
    /// to the named type's own `new`, which is the one place they are validated.
    ///
    /// # Errors
    ///
    /// [`TaskError::UnknownName`] for a key this crate does not implement — never a
    /// fallback type — and whatever the named type's own `new` refuses about the
    /// parameters.
    pub fn of(key: &str, parameters: &Value) -> Result<Self, TaskError> {
        match key {
            "Batch" => Ok(Self::Batch(Batch::new(parameters)?)),
            "BatchAndOutput" => Ok(Self::BatchAndOutput(BatchAndOutput::new(parameters)?)),
            "OutputOnly" => Ok(Self::OutputOnly(OutputOnly::new(parameters)?)),
            "TwoSteps" => Ok(Self::TwoSteps(TwoSteps::new(parameters)?)),
            "Communication" => Ok(Self::Communication(Communication::new(parameters)?)),
            other => Err(TaskError::UnknownName {
                name: other.to_owned(),
            }),
        }
    }

    /// The key the `task_type` column holds, which is the class name the reference
    /// registers the type under.
    #[must_use]
    pub fn registry_key(&self) -> &'static str {
        match self {
            Self::Batch(_) => "Batch",
            Self::BatchAndOutput(_) => "BatchAndOutput",
            Self::OutputOnly(_) => "OutputOnly",
            Self::TwoSteps(_) => "TwoSteps",
            Self::Communication(_) => "Communication",
        }
    }

    /// The human label a user is shown, which differs from the key for two of the five
    /// and is never what a column holds.
    #[must_use]
    pub fn label(&self) -> &'static str {
        match self {
            Self::Batch(_) => "Batch",
            Self::BatchAndOutput(_) => "BatchAndOutput",
            Self::OutputOnly(_) => "Output only",
            Self::TwoSteps(_) => "Two steps",
            Self::Communication(_) => "Communication",
        }
    }
}
