//! What a task type declares its parameters to be, and the check each configured value
//! is held to before the task type is built.
//!
//! The reference declares a task type's parameters as a list of `ParameterType` objects
//! and validates the values against that list when the task type is constructed
//! (`ParameterTypes.py`, `tasktypes/abc.py:105-126`). Only that half lives here: the
//! form each type renders for the admin panel is the panel's business.
//!
//! Two rules of the reference are kept because each decides which configurations are
//! accepted. A choice is matched against the value's own text, so a number names a
//! choice that spells it, and a collection's length is checked before its elements are,
//! each element then held to the type declared for it. The integer rule is the one
//! deliberate departure: a value is a count this worker can hold, so a boolean, a
//! fraction and a negative number are refused, where the reference's
//! `isinstance(value, int)` admits the first and the last.
//!
//! # Errors
//!
//! [`TaskError::Parameters`] for a value that is not the list the task type declares,
//! and [`TaskError::Parameter`] for an entry that is not what its declaration accepts.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod declared;
mod reading;

pub use declared::{Accepts, Parameter};
pub(crate) use reading::Parameters;
