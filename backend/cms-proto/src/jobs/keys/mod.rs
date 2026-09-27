//! The exact key sets the Python job payloads carry, one per job kind.
//!
//! `Job.export_to_dict` writes seventeen keys and each subclass adds its own on
//! top: `CompilationJob.export_to_dict` adds `compilation_success` and
//! `EvaluationJob.export_to_dict` adds eight, on top of the `type` and `plus`
//! both carry, so nineteen keys are common to the two and a compilation job is
//! twenty keys where an evaluation job is twenty-seven. `ESOperation.to_dict`
//! writes five, and it sits inside the job, so it has a key set of its own.
//!
//! A set is only worth writing out if something refuses a job that does not
//! match it, so the refusal lives here next to the sets: Python imports a job
//! with `cls(**data)`, which raises `TypeError` on a key the constructor does
//! not take and on one it needs and did not get. [`check_key_set`] is that
//! refusal, and it runs inside the decode of a single job, so a job carrying
//! the wrong keys costs only itself.
//!
//! [`sets`] pins the key names, [`kind`] decides which set a job must match,
//! [`read`] takes a field out of an object once it has, and [`JobKey`] names
//! the keys this crate claims in a type that cannot hold a name nothing here
//! reads.

mod kind;
mod name;
mod read;
mod sets;

pub use kind::{key_set_for, JobKind};
pub use name::JobKey;
pub use read::{check_key_set, field, read_name};
pub use sets::{
    DigestMap, COMPILATION_KEYS, COMPILATION_TYPE, DIGEST_MAP_KEYS, EVALUATION_EXECUTION_KEYS,
    EVALUATION_KEYS, EVALUATION_TYPE, OPERATION_KEYS, OPERATION_TYPES,
};
