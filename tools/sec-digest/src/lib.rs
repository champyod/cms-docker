//! The CMS security digest: deterministic feeds and ranking, plus a guarded model stage.
//!
//! Feeds are collected, merged, ranked against the fleet inventory and rendered as
//! a template brief. A model may rewrite the prose only through `llm`, which drops
//! any answer that names an id the collector did not read. Nothing here invents a
//! fact: every line comes from an advisory that carries the URL it was published
//! at, and a feed that fails is reported as failed rather than shown as an empty list.

pub mod feeds;
pub mod fleet_state;
pub mod deliver;
pub mod http;
pub mod inventory;
pub mod llm;
pub mod matchtext;
pub mod model;
pub mod rank;
pub mod record;
pub mod render;
pub mod seen;
pub mod text;
pub mod timeutil;
pub mod vers;

pub use model::{Advisory, Feeds};
