//! The subtasks a dataset's parameters describe, and the testcases each one selects.
//!
//! A group score type's parameters are a list of `[weight, selector]` entries, with a
//! threshold after the selector where the score type has one. The selector is the only
//! part with a choice in it: a count takes that many testcases from the ones the dataset
//! holds, in codename order, and a pattern takes every testcase whose codename it matches.
//! The choice is per dataset, and all the entries must make the same one, because a list
//! that counted some subtasks and matched others would have no order to consume testcases
//! in.
//!
//! The matching itself is [`crate::scoretypes::pattern`], which reads the part of a
//! regular expression datasets use and refuses the rest. What is here is the grouping: the
//! codenames in the order the dataset names them, and the slices a count or a pattern
//! carves out of them.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use serde_json::Value;

use super::error::ScoreTypeError;
use super::pattern;

/// How a subtask names the testcases it is made of.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Selector {
    /// That many testcases, consumed in codename order.
    Count(usize),
    /// Every testcase whose codename the pattern matches from its first character.
    Pattern(String),
}

/// One subtask, with the testcases it selects already resolved.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GroupParameter {
    /// The subtask's weight, which its fraction is multiplied by.
    pub max_score: f64,
    /// The codenames of the subtask, in the dataset's order.
    pub targets: Vec<String>,
    /// The threshold a testcase's outcome must not exceed, where the score type has one.
    pub threshold: Option<f64>,
}

/// `Sum`'s parameter: what one testcase's outcome is multiplied by.
pub(crate) fn sum_parameter(parameters: &Value) -> Result<f64, ScoreTypeError> {
    parameters
        .as_f64()
        .ok_or(ScoreTypeError::Parameters { name: "Sum" })
}

/// The subtasks a group score type's parameters describe.
pub(crate) fn group_parameters(
    parameters: &Value,
    public_testcases: &BTreeMap<String, bool>,
    thresholded: bool,
    name: &'static str,
) -> Result<Vec<GroupParameter>, ScoreTypeError> {
    let entries = parameters
        .as_array()
        .ok_or(ScoreTypeError::Parameters { name })?;
    let mut weights = Vec::with_capacity(entries.len());
    let mut selectors = Vec::with_capacity(entries.len());
    let mut thresholds = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        let entry = entry
            .as_array()
            .ok_or(ScoreTypeError::Group { name, index })?;
        let weight = entry
            .first()
            .and_then(Value::as_f64)
            .ok_or(ScoreTypeError::Group { name, index })?;
        let selector = entry
            .get(1)
            .and_then(selector_of)
            .ok_or(ScoreTypeError::Group { name, index })?;
        let threshold = if thresholded {
            Some(
                entry
                    .get(2)
                    .and_then(Value::as_f64)
                    .ok_or(ScoreTypeError::Group { name, index })?,
            )
        } else {
            // A third entry is the subtask's name, which the loaders write and this ignores.
            None
        };
        weights.push(weight);
        selectors.push(selector);
        thresholds.push(threshold);
    }
    let targets = target_testcases(&selectors, public_testcases)?;
    Ok(weights
        .into_iter()
        .zip(targets)
        .zip(thresholds)
        .map(|((max_score, targets), threshold)| GroupParameter {
            max_score,
            targets,
            threshold,
        })
        .collect())
}

/// The selector one entry names, or `None` for a value that is neither a count nor a pattern.
fn selector_of(value: &Value) -> Option<Selector> {
    if let Some(count) = value.as_u64() {
        return usize::try_from(count).ok().map(Selector::Count);
    }
    value
        .as_str()
        .map(|pattern| Selector::Pattern(pattern.to_owned()))
}

/// The testcases of every subtask, refusing a list whose entries select in two ways.
fn target_testcases(
    selectors: &[Selector],
    public_testcases: &BTreeMap<String, bool>,
) -> Result<Vec<Vec<String>>, ScoreTypeError> {
    let codenames: Vec<String> = public_testcases.keys().cloned().collect();
    if selectors.iter().all(|s| matches!(s, Selector::Count(_))) {
        return counted_targets(selectors, &codenames);
    }
    if selectors.iter().all(|s| matches!(s, Selector::Pattern(_))) {
        return patterned_targets(selectors, &codenames);
    }
    Err(ScoreTypeError::MixedSelectors)
}

/// The testcases each count consumes, from the codenames in order.
fn counted_targets(
    selectors: &[Selector],
    codenames: &[String],
) -> Result<Vec<Vec<String>>, ScoreTypeError> {
    let mut current: usize = 0;
    let mut targets = Vec::with_capacity(selectors.len());
    for (index, selector) in selectors.iter().enumerate() {
        let Selector::Count(count) = selector else {
            unreachable!("every selector of this list is a count");
        };
        let end = current.saturating_add(*count).min(codenames.len());
        let target = codenames[current.min(end)..end].to_vec();
        if target.is_empty() {
            return Err(ScoreTypeError::EmptyGroup { index });
        }
        targets.push(target);
        current = end;
    }
    Ok(targets)
}

/// The testcases each pattern matches, in codename order.
fn patterned_targets(
    selectors: &[Selector],
    codenames: &[String],
) -> Result<Vec<Vec<String>>, ScoreTypeError> {
    let mut targets = Vec::with_capacity(selectors.len());
    for selector in selectors {
        let Selector::Pattern(pattern) = selector else {
            unreachable!("every selector of this list is a pattern");
        };
        let mut target = Vec::new();
        for codename in codenames {
            match pattern::matches(pattern, codename) {
                Some(true) => target.push(codename.clone()),
                Some(false) => {}
                None => {
                    return Err(ScoreTypeError::UnsupportedPattern {
                        pattern: pattern.clone(),
                    })
                }
            }
        }
        if target.is_empty() {
            return Err(ScoreTypeError::UnmatchedPattern {
                pattern: pattern.clone(),
            });
        }
        targets.push(target);
    }
    Ok(targets)
}
