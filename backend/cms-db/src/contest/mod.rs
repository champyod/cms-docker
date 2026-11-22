//! The `contests` row: its time window, the phase that window implies, and the
//! tokens the contest issues.
//!
//! `src/cms/db/contest.py` holds the table and the one piece of behaviour the
//! server asks of it, `Contest.phase`. The window and the phase live in
//! `window`; the token configuration and its check constraints live in `token`
//! and `model` carries the row that ties them together.

mod window;

pub use window::{ContestWindow, Phase, WindowError};
