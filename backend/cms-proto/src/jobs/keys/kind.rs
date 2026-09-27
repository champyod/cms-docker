//! Which of the two job shapes a job has, and therefore which key set it must
//! carry.

use serde_json::{Map, Value};

use super::name::JobKey;
use super::read::read_name;
use super::sets::{COMPILATION_KEYS, COMPILATION_TYPE, EVALUATION_KEYS, EVALUATION_TYPE};
use crate::jobs::refusal::JobError;

/// Which of the two job shapes a job has, as its `type` key names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobKind {
    /// The twenty-key `CompilationJob` shape.
    Compilation,
    /// The twenty-seven-key `EvaluationJob` shape.
    Evaluation,
}

impl JobKind {
    /// The `type` value this kind is written as.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Compilation => COMPILATION_TYPE,
            Self::Evaluation => EVALUATION_TYPE,
        }
    }

    /// Reads the `type` key, which is what `import_from_dict_with_type`
    /// dispatches on, refusing a value that names neither shape.
    ///
    /// # Errors
    ///
    /// Returns [`JobError::UnknownJobType`] for a string that is neither
    /// [`COMPILATION_TYPE`] nor [`EVALUATION_TYPE`], and
    /// [`JobError::WrongValue`] naming the key when it is not a string at all.
    pub fn read(object: &Map<String, Value>) -> Result<Self, JobError> {
        let found = read_name(object, JobKey::TYPE)?;
        match found.as_str() {
            COMPILATION_TYPE => Ok(Self::Compilation),
            EVALUATION_TYPE => Ok(Self::Evaluation),
            _ => Err(JobError::UnknownJobType { found }),
        }
    }
}

/// The key set a job of this kind must carry.
///
/// # Errors
///
/// None. The set is a property of the kind, and a job that does not match it is
/// refused by `check_key_set`, which is where the sets are enforced.
#[must_use]
pub const fn key_set_for(kind: JobKind) -> &'static [&'static str] {
    match kind {
        JobKind::Compilation => &COMPILATION_KEYS,
        JobKind::Evaluation => &EVALUATION_KEYS,
    }
}
