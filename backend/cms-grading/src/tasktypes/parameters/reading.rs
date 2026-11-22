//! The parameters a task type was configured with, read against what it declares.
//!
//! One type, [`Parameters`], is both the check and the reading: [`Parameters::of`] refuses
//! the configuration unless every value is what its declaration names, and the accessors
//! then answer with that value and cannot fail. A task type that reads each entry itself
//! states what its parameters are twice, and the two statements drift.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::borrow::Cow;

use serde_json::Value;

use super::declared::{text_of, Accepts, Parameter};
use crate::tasktypes::TaskError;

/// The parameters a task type was configured with, checked against its declaration.
pub(crate) struct Parameters<'a> {
    values: &'a [Value],
    declared: &'static [Parameter],
}

impl<'a> Parameters<'a> {
    /// The configured parameters, refused unless they are one value per declaration and
    /// every value is what its declaration accepts.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the value is a list holding exactly the declared
    /// number of entries, and [`TaskError::Parameter`] for the first entry that is not
    /// what its declaration accepts.
    pub(crate) fn of(
        configured: &'a Value,
        declared: &'static [Parameter],
    ) -> Result<Self, TaskError> {
        let values = configured.as_array().ok_or(TaskError::Parameters)?;
        if values.len() != declared.len() {
            return Err(TaskError::Parameters);
        }
        for (value, parameter) in values.iter().zip(declared) {
            parameter.validate(value)?;
        }
        Ok(Self { values, declared })
    }

    /// The string at `index`, which a declaration of a string or of a choice both hold:
    /// a choice is matched against the value's own text, and that text is what the task
    /// type reads back.
    ///
    /// A task type reading another kind is a mistake in the task type rather than a
    /// refusal of the configuration, and panics naming the parameter.
    pub(crate) fn text(&self, index: usize) -> Cow<'a, str> {
        let parameter = self.declaration(index);
        assert!(
            matches!(parameter.accepts, Accepts::Text | Accepts::Choice(_)),
            "parameter `{}` is not declared a string or a choice",
            parameter.name
        );
        text_of(self.value(index))
    }

    /// The integer at `index`, whose declaration says it is one.
    pub(crate) fn integer(&self, index: usize) -> u64 {
        let parameter = self.declaration(index);
        assert!(
            matches!(parameter.accepts, Accepts::Integer),
            "parameter `{}` is not declared an integer",
            parameter.name
        );
        self.value(index)
            .as_u64()
            .expect("a validated parameter is the kind its declaration names")
    }

    /// The parameters of the list at `index`, read by the declaration of its entries.
    pub(crate) fn list(&self, index: usize) -> Parameters<'a> {
        let parameter = self.declaration(index);
        let Accepts::List(subparameters) = &parameter.accepts else {
            panic!("parameter `{}` is not declared a list", parameter.name);
        };
        Parameters {
            values: self
                .value(index)
                .as_array()
                .expect("a validated list is the list its declaration names")
                .as_slice(),
            declared: subparameters,
        }
    }

    /// The value at `index`, which is there because the count was checked.
    fn value(&self, index: usize) -> &'a Value {
        &self.values[index]
    }

    /// The declaration of the value at `index`, which is there for the same reason.
    fn declaration(&self, index: usize) -> &'static Parameter {
        &self.declared[index]
    }
}
