//! Assemble the fleet state: every checkout, the waiver register, one probe per host.
//!
//! Errors survive as data and are also flattened into `errors`, so a caller that
//! only prints the block still has the reason the block is short.

use std::path::PathBuf;

use chrono::{DateTime, Utc};

use crate::fleet_state::exec::Runner;
use crate::fleet_state::probe::{parse_hosts, HostSpec, DEFAULT_HOSTS, HOSTS_ENV};
use crate::fleet_state::repos::{repo_state, REPOS};
use crate::fleet_state::servers::{server_state, uncovered};
use crate::fleet_state::waivers::waivers_at;
use crate::fleet_state::FleetState;

/// Where the checkouts live and which hosts to ask; both come from the CLI or env.
pub struct Config {
    pub hub: PathBuf,
    pub hosts: Vec<HostSpec>,
}

impl Config {
    pub fn new(hub: impl Into<PathBuf>, hosts: Vec<HostSpec>) -> Self {
        Self {
            hub: hub.into(),
            hosts,
        }
    }

    /// `SEC_DIGEST_HOSTS` when set, the production host otherwise.
    pub fn from_env(hub: impl Into<PathBuf>) -> Self {
        let raw = std::env::var(HOSTS_ENV).unwrap_or_else(|_| DEFAULT_HOSTS.to_string());
        Self::new(hub, parse_hosts(&raw))
    }
}

fn collect_repos(config: &Config, runner: &dyn Runner, state: &mut FleetState) {
    for spec in &REPOS {
        let repo = repo_state(runner, &config.hub, spec);
        if let Some(error) = &repo.error {
            state.errors.push(format!("{}: {error}", repo.repo));
        }
        state.repos.push(repo);
    }
}

pub fn collect(config: &Config, runner: &dyn Runner, now: DateTime<Utc>) -> FleetState {
    let mut state = FleetState::default();
    collect_repos(config, runner, &mut state);
    state.waivers = waivers_at(&config.hub, now.date_naive());
    state.servers = server_state(runner, &config.hosts);
    for server in &state.servers {
        if let Some(error) = &server.error {
            state.errors.push(format!("{}: {error}", server.host));
        }
    }
    state.uncovered = uncovered(&state.servers);
    state
}
