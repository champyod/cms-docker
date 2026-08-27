//! Worker registry parsed from .env.core WORKER_N lines.

use crate::data::{docker, env};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerRow {
    pub shard: u32,
    pub host: String,
    pub port: u16,
    pub running: bool,
}

/// Every registered worker with its live docker cross-check.
pub async fn fleet() -> Vec<WorkerRow> {
    let states = docker::service_states().await.unwrap_or_default();
    registered()
        .into_iter()
        .map(|(shard, host, port)| WorkerRow {
            shard,
            host,
            port,
            running: worker_running(&states, shard),
        })
        .collect()
}

/// WORKER_N=host:port entries sorted by shard number.
fn registered() -> Vec<(u32, String, u16)> {
    let values = env::parse(&env::repo_root().join(env::CORE_ENV_FILE));
    let mut rows: Vec<(u32, String, u16)> =
        values.iter().filter_map(parse_worker_line).collect();
    rows.sort_by_key(|(shard, _, _)| *shard);
    rows
}

fn parse_worker_line((key, value): (&String, &String)) -> Option<(u32, String, u16)> {
    let shard = key.strip_prefix("WORKER_")?.parse::<u32>().ok()?;
    let (host, port_raw) = value.split_once(':')?;
    let port = port_raw.parse::<u16>().ok()?;
    Some((shard, host.to_string(), port))
}

fn worker_running(states: &[(String, docker::ServiceState)], shard: u32) -> bool {
    let container = format!("cms-worker-{shard}");
    states
        .iter()
        .find(|(name, _)| *name == container)
        .is_some_and(|(_, state)| {
            matches!(
                state,
                docker::ServiceState::Running
                    | docker::ServiceState::Starting
                    | docker::ServiceState::Working
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_worker_lines() {
        let key = "WORKER_3".to_string();
        let value = "10.0.0.5:9203".to_string();
        assert_eq!(
            parse_worker_line((&key, &value)),
            Some((3, "10.0.0.5".to_string(), 9203))
        );
    }

    #[test]
    fn rejects_malformed_lines() {
        let bad_key = "OTHER_1".to_string();
        let value = "h:1".to_string();
        assert_eq!(parse_worker_line((&bad_key, &value)), None);
        let key = "WORKER_x".to_string();
        assert_eq!(parse_worker_line((&key, &value)), None);
        let key = "WORKER_2".to_string();
        let no_port = "hostonly".to_string();
        assert_eq!(parse_worker_line((&key, &no_port)), None);
    }
}
