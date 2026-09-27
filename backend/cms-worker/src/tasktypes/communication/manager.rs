//! What a manager printed, and the two audiences it printed it for.
//!
//! The score is on the manager's standard output, the sentence a contestant is
//! shown is on its standard error, and the lines it marks with a prefix are for the
//! administrators alone, which is the reference's own reading of a manager's two
//! streams. A manager that printed no score, or one that could not be read as a
//! number, has not done what it was asked to whatever the boxes reported, and that
//! is said to the administrators rather than to a contestant, who has nothing to do
//! with it.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use crate::stats::ExecutionStats;

/// The prefix a manager marks a line with for the administrators rather than for a
/// contestant, which is the reference's own marker.
const ADMIN_PREFIX: &str = "ADMIN_MESSAGE:";
/// Said to the administrators when a manager printed nothing a score can be read
/// from, and said to nobody else.
const UNREADABLE: &str = "The manager printed no score that could be read";

/// The score, the contestant's sentence and the administrators' own, read out of
/// what the manager printed.
pub(super) fn from_manager(manager: &ExecutionStats) -> (Option<f64>, Vec<String>, Option<String>) {
    let said = manager.stderr.as_deref().unwrap_or_default();
    let mut lines = said.lines();
    let text = lines.next().unwrap_or_default().trim().to_owned();
    let admin = admin_lines(lines);
    let score = manager
        .stdout
        .as_deref()
        .unwrap_or_default()
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .parse::<f64>();
    match score {
        Ok(outcome) => (Some(outcome), vec![text], admin),
        Err(_) => (
            None,
            vec![text],
            Some(admin.unwrap_or_else(|| UNREADABLE.to_owned())),
        ),
    }
}

/// The lines a manager marked for the administrators rather than for a contestant,
/// joined the way the reference joins them, and absent where it marked none.
fn admin_lines<'a>(lines: impl Iterator<Item = &'a str>) -> Option<String> {
    let said: Vec<&str> = lines
        .map(str::trim)
        .filter_map(|line| line.strip_prefix(ADMIN_PREFIX))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    (!said.is_empty()).then(|| said.join(" "))
}
