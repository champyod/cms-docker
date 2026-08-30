// Core Engine (Headless): All business logic resides here.
// This module defines the data model and functions for interacting
// with Docker, executing bash scripts, and managing configurations.
// It is used by both the CLI and TUI frontends.

pub mod config;
pub mod docker;
pub mod model;
pub mod runner;
pub mod scripts;

pub use model::*;
