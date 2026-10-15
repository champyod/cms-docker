use std::collections::BTreeMap;

use crate::scoring::Ledger;
use crate::store::StoreError;
use crate::AppState;

/// The board diffed between notifications: the per-pair scores and the per-user summary
/// the last notification published, so the next one announces only what moved.
#[derive(Default)]
pub struct Snapshot {
    pub scores: BTreeMap<(String, String), f64>,
    pub rows: BTreeMap<String, (f64, i64)>,
}

/// The score events a projection change implies: every pair whose value moved, plus
/// the pairs that dropped off the board, which Python reported as 0.0.
pub fn score_changes(
    previous: &BTreeMap<(String, String), f64>,
    next: &BTreeMap<(String, String), f64>,
) -> Vec<(String, String, f64)> {
    let mut changes = Vec::new();
    for ((user, task), score) in next {
        if previous.get(&(user.clone(), task.clone())) != Some(score) {
            changes.push((user.clone(), task.clone(), *score));
        }
    }
    for (user, task) in previous.keys() {
        if !next.contains_key(&(user.clone(), task.clone())) {
            changes.push((user.clone(), task.clone(), 0.0));
        }
    }
    changes
}

pub fn board_of(ledger: &Ledger) -> BTreeMap<(String, String), f64> {
    let mut board = BTreeMap::new();
    for (user, tasks) in ledger.scores() {
        for (task, score) in tasks {
            board.insert((user.clone(), task.clone()), *score);
        }
    }
    board
}

/// One user's place on the board: the score shown and the rank, the two numbers a live
/// score change moves without renaming anyone.
pub fn summary_of(ledger: &Ledger) -> BTreeMap<String, (f64, i64)> {
    ledger
        .board()
        .iter()
        .map(|row| (row.key.clone(), (row.score, row.rank.unwrap_or(0))))
        .collect()
}

/// The rows whose score or rank moved, and the keys that left the board. A key with no
/// numbers is a removal, so the page never has to refetch to learn that.
pub fn board_changes(
    previous: &BTreeMap<String, (f64, i64)>,
    next: &BTreeMap<String, (f64, i64)>,
) -> Vec<(String, Option<(f64, i64)>)> {
    let mut changes = Vec::new();
    for (key, value) in next {
        if previous.get(key) != Some(value) {
            changes.push((key.clone(), Some(*value)));
        }
    }
    for key in previous.keys() {
        if !next.contains_key(key) {
            changes.push((key.clone(), None));
        }
    }
    changes
}

/// The board already on disk, so the first notification after start-up announces
/// only what changed rather than the whole contest. It reads the shared build, which
/// is what the endpoints serve too.
pub async fn initial_snapshot(state: &AppState) -> Snapshot {
    match state.standings().await {
        Ok(standings) => Snapshot {
            scores: board_of(&standings.ledger),
            rows: summary_of(&standings.ledger),
        },
        Err(error) => {
            eprintln!("cms-ranking: the score board was not loaded: {error}");
            Snapshot::default()
        }
    }
}

/// The changed pairs as one payload: one "user task score" line each, which is what the
/// page's score listener splits on, and None when nothing moved so an idle pass sends
/// no frame. A frame per pair would evict the replay window a reconnect reads.
pub fn score_payload(changes: &[(String, String, f64)]) -> Option<String> {
    if changes.is_empty() {
        return None;
    }
    Some(
        changes
            .iter()
            .map(|(user, task, score)| format!("{user} {task} {}", python_float(*score)))
            .collect::<Vec<String>>()
            .join("\n"),
    )
}

/// Rebuilds the shared board (the caller has already dropped the cache) and publishes
/// one "score" event carrying every changed pair and one "board" event carrying every
/// changed row, so a page updates in place instead of refetching the whole board.
pub async fn publish_changes(
    state: &AppState,
    previous: &Snapshot,
) -> Result<Snapshot, StoreError> {
    let standings = state.standings().await?;
    let scores = board_of(&standings.ledger);
    if let Some(payload) = score_payload(&score_changes(&previous.scores, &scores)) {
        state.feed().publish("score", payload);
    }
    let rows = summary_of(&standings.ledger);
    let lines: Vec<String> = board_changes(&previous.rows, &rows)
        .into_iter()
        .map(|(key, value)| match value {
            Some((score, rank)) => format!("{key} {} {rank}", python_float(score)),
            None => key,
        })
        .collect();
    if !lines.is_empty() {
        state.feed().publish("board", lines.join("\n"));
    }
    Ok(Snapshot { scores, rows })
}

/// Python's str(float) keeps the decimal point on a whole number, which Display
/// drops and Debug keeps: the capture carries "100.0", not "100".
pub fn python_float(value: f64) -> String {
    format!("{value:?}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(entries: &[(&str, f64, i64)]) -> BTreeMap<String, (f64, i64)> {
        entries
            .iter()
            .map(|(key, score, rank)| (key.to_string(), (*score, *rank)))
            .collect()
    }

    /// A rank move on an unchanged score still has to be announced, because the page
    /// shows the rank and would otherwise keep the stale one.
    #[test]
    fn a_rank_move_is_a_change() {
        let previous = rows(&[("u0", 10.0, 1), ("u1", 5.0, 2)]);
        let next = rows(&[("u0", 10.0, 2), ("u1", 5.0, 1)]);
        let changes = board_changes(&previous, &next);
        assert_eq!(changes.len(), 2);
        assert!(changes.contains(&("u0".to_string(), Some((10.0, 2)))));
    }

    /// A key that disappears is published as a removal, and an unchanged row is silent.
    #[test]
    fn a_removal_is_a_change_and_a_still_row_is_not() {
        let previous = rows(&[("u0", 10.0, 1), ("u1", 5.0, 2)]);
        let next = rows(&[("u0", 10.0, 1)]);
        assert_eq!(
            board_changes(&previous, &next),
            vec![("u1".to_string(), None)]
        );
        assert!(board_changes(&next, &next).is_empty());
    }
}
