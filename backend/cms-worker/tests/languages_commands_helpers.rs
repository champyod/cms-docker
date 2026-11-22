//! The argv the command tests compare against, written as the words themselves.
//!
//! An expectation is spelled out word for word rather than built by the code it is
//! checking: a helper that assembled the same command would agree with a language
//! that dropped `-DEVAL`, and the point of these tests is that it cannot.

#![allow(dead_code)]

/// One command line, as the list of words it is handed to a box.
pub fn words(items: &[&str]) -> Vec<String> {
    items.iter().map(|word| (*word).to_owned()).collect()
}
