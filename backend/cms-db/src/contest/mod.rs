//! The `contests` row: its time window, the phase that window implies, and the
//! tokens the contest issues.
//!
//! `src/cms/db/contest.py` holds the table and the one piece of behaviour the
//! server asks of it, `Contest.phase`. The window and the phase live in
//! `window`; the token configuration and its check constraints live in `token`;
//! `model` carries the row that ties them together, with `limits` holding the
//! resource checks the reference left to the database.

mod limits;
mod model;
mod reads;
mod rows;
mod schema;
mod token;
mod window;

pub use limits::ContestError;
pub use model::Contest;
pub use reads::{get_contest_list, is_contest_id, CONTEST_EXISTS, CONTEST_LIST};
pub use schema::CONTEST;
pub use token::{TokenConfigError, TokenPolicy};
pub use window::{ContestWindow, Phase, WindowError};
