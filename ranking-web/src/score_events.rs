use std::collections::BTreeMap;

use crate::db::Db;
use crate::feed::Feed;
use crate::scoring::Ledger;
use crate::store::{load_ledger, StoreError};

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

/// The board already on disk, so the first notification after start-up announces
/// only what changed rather than the whole contest.
pub async fn initial_board(db: &Db) -> BTreeMap<(String, String), f64> {
    match load_ledger(db.pool()).await {
        Ok(ledger) => board_of(&ledger),
        Err(error) => {
            eprintln!("cms-ranking: the score board was not loaded: {error}");
            BTreeMap::new()
        }
    }
}

/// Recomputes the board, publishes one "score" event per changed pair, and returns
/// the board for the next diff.
pub async fn publish_changes(
    db: &Db,
    feed: &Feed,
    previous: &BTreeMap<(String, String), f64>,
) -> Result<BTreeMap<(String, String), f64>, StoreError> {
    let ledger = load_ledger(db.pool()).await?;
    let next = board_of(&ledger);
    for (user, task, score) in score_changes(previous, &next) {
        feed.publish("score", format!("{user} {task} {}", python_float(score)));
    }
    Ok(next)
}

/// Python's str(float) keeps the decimal point on a whole number, which Display
/// drops and Debug keeps: the capture carries "100.0", not "100".
pub fn python_float(value: f64) -> String {
    format!("{value:?}")
}
