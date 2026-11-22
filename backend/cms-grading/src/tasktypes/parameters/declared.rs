//! One parameter a task type declares, and the check a configured value is held to.
//!
//! A declaration is data rather than a class hierarchy: what a value has to be is
//! [`Accepts`], and [`Parameter`] is the name an administrator reads beside it. The
//! reference's form rendering is not here, because it belongs to the admin panel.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::borrow::Cow;
use std::fmt;

use serde_json::Value;

use crate::tasktypes::TaskError;

/// What a value for a parameter has to be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Accepts {
    /// A JSON string.
    Text,
    /// A JSON integer this worker can count with: not a boolean, a fraction or a
    /// negative number.
    Integer,
    /// One of these choices, matched against the value's own text.
    Choice(&'static [&'static str]),
    /// A list of exactly these parameters, in this order.
    List(&'static [Parameter]),
}

impl fmt::Display for Accepts {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Text => f.write_str("must be a string"),
            Self::Integer => f.write_str("must be an integer"),
            Self::Choice(choices) => {
                f.write_str("must be one of ")?;
                for (index, choice) in choices.iter().enumerate() {
                    if index > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "`{choice}`")?;
                }
                Ok(())
            }
            Self::List(subparameters) => {
                write!(f, "must be a list of {} parameters", subparameters.len())
            }
        }
    }
}

/// One parameter a task type accepts, as the reference's `ParameterType` declares it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parameter {
    /// The name an administrator reads for the parameter.
    pub name: &'static str,
    /// The name the admin panel builds an HTML field id from.
    pub short_name: &'static str,
    /// What the parameter does, as the admin panel describes it.
    pub description: &'static str,
    /// What a value for it has to be.
    pub accepts: Accepts,
}

impl Parameter {
    /// A parameter whose value is a string.
    pub(crate) const fn text(
        name: &'static str,
        short_name: &'static str,
        description: &'static str,
    ) -> Self {
        Self {
            name,
            short_name,
            description,
            accepts: Accepts::Text,
        }
    }

    /// A parameter whose value is an integer.
    pub(crate) const fn integer(
        name: &'static str,
        short_name: &'static str,
        description: &'static str,
    ) -> Self {
        Self {
            name,
            short_name,
            description,
            accepts: Accepts::Integer,
        }
    }

    /// A parameter whose value is one of `choices`.
    pub(crate) const fn choice(
        name: &'static str,
        short_name: &'static str,
        description: &'static str,
        choices: &'static [&'static str],
    ) -> Self {
        Self {
            name,
            short_name,
            description,
            accepts: Accepts::Choice(choices),
        }
    }

    /// A parameter whose value is a list of `subparameters`.
    pub(crate) const fn list(
        name: &'static str,
        short_name: &'static str,
        description: &'static str,
        subparameters: &'static [Parameter],
    ) -> Self {
        Self {
            name,
            short_name,
            description,
            accepts: Accepts::List(subparameters),
        }
    }

    /// Refuses a value that is not what this parameter declares.
    pub(crate) fn validate(&self, value: &Value) -> Result<(), TaskError> {
        match &self.accepts {
            Accepts::Text if value.is_string() => Ok(()),
            Accepts::Integer if value.as_u64().is_some() => Ok(()),
            Accepts::Choice(choices) if names_one_of(choices, value) => Ok(()),
            Accepts::List(subparameters) => self.validate_list(subparameters, value),
            _ => Err(self.refusal(value)),
        }
    }

    /// Refuses a list of the wrong length or shape, and otherwise holds each element to
    /// the type declared for it, so a refusal names the element and not the list.
    fn validate_list(
        &self,
        subparameters: &'static [Parameter],
        value: &Value,
    ) -> Result<(), TaskError> {
        let Some(values) = value.as_array() else {
            return Err(self.refusal(value));
        };
        if values.len() != subparameters.len() {
            return Err(self.refusal(value));
        }
        values
            .iter()
            .zip(subparameters)
            .try_for_each(|(value, parameter)| parameter.validate(value))
    }

    /// The refusal a task type answers with, naming the declaration's own name for the
    /// parameter, what it accepts and the value it was given, which is what the
    /// reference's per-type messages carry and what an administrator has to correct.
    fn refusal(&self, value: &Value) -> TaskError {
        TaskError::Parameter {
            name: self.name,
            accepts: self.accepts.clone(),
            value: value.clone(),
        }
    }
}

/// Whether the value is one of the choices, compared as the value's own text: the
/// reference compares `str(value)`, so a number names the choice that spells it.
fn names_one_of(choices: &[&str], value: &Value) -> bool {
    let text = text_of(value);
    choices.iter().any(|choice| *choice == &*text)
}

/// The value as the text a choice is compared with: a JSON string is itself, and every
/// other value is its own rendering.
pub(super) fn text_of(value: &Value) -> Cow<'_, str> {
    match value {
        Value::String(text) => Cow::Borrowed(text),
        other => Cow::Owned(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A choice among the two spellings a whole number and a fraction have, which no
    /// shipped task type declares, so the rule is pinned on a declaration of its own.
    const NUMERIC: Parameter = Parameter::choice("Numeric", "numeric", "", &["1", "1.0"]);

    #[test]
    fn a_choice_is_matched_against_the_value_own_text() {
        for accepted in [json!("1"), json!(1), json!(1.0), json!("1.0")] {
            assert!(
                NUMERIC.validate(&accepted).is_ok(),
                "{accepted} names a choice"
            );
        }
        for refused in [json!(2), json!(true), json!([1]), json!("01")] {
            assert!(
                NUMERIC.validate(&refused).is_err(),
                "{refused} names none of them"
            );
        }
    }
}
