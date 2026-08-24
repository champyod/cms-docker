//! Docker container status collector (bollard over the default socket).

use anyhow::Result;
use bollard::container::ListContainersOptions;
use bollard::Docker;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceState {
    Running,
    Stopped,
    Erroring,
    Starting,
    Unhealthy,
    Working,
}

impl ServiceState {
    pub fn label(self) -> &'static str {
        match self {
            ServiceState::Running => "run",
            ServiceState::Stopped => "stop",
            ServiceState::Erroring => "error",
            ServiceState::Starting => "start",
            ServiceState::Unhealthy => "unhealthy",
            ServiceState::Working => "work",
        }
    }
}

/// Lists every container as (name, classified state).
pub async fn service_states() -> Result<Vec<(String, ServiceState)>> {
    let docker = Docker::connect_with_socket_defaults()?;
    let options = ListContainersOptions::<String> {
        all: true,
        ..Default::default()
    };
    let containers = docker.list_containers(Some(options)).await?;
    Ok(containers
        .iter()
        .filter_map(|summary| {
            let names = summary.names.as_ref()?;
            let name = container_name(names)?;
            let state = classify(
                summary.state.as_deref().unwrap_or("unknown"),
                summary.status.as_deref().unwrap_or(""),
            );
            Some((name, state))
        })
        .collect())
}

/// Looks up a service by short name, trying the `cms-` prefixed form first.
pub fn lookup(
    states: &[(String, ServiceState)],
    short: &str,
) -> Option<ServiceState> {
    let candidates = [format!("cms-{short}"), short.to_string()];
    for candidate in candidates {
        if let Some((_, state)) = states.iter().find(|(name, _)| *name == candidate) {
            return Some(*state);
        }
    }
    None
}

fn container_name(names: &[String]) -> Option<String> {
    names
        .first()
        .map(|name| name.trim_start_matches('/').to_string())
}

/// Maps docker state + human status string to the six-state enum.
fn classify(state: &str, status: &str) -> ServiceState {
    match state {
        "running" if status.contains("(unhealthy)") => ServiceState::Unhealthy,
        "running" if status.contains("health: starting") => ServiceState::Starting,
        "running" => ServiceState::Running,
        "restarting" => ServiceState::Erroring,
        "paused" => ServiceState::Working,
        _ => ServiceState::Stopped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_running_health_variants() {
        assert_eq!(
            classify("running", "Up 3 hours (healthy)"),
            ServiceState::Running
        );
        assert_eq!(
            classify("running", "Up 2 minutes (health: starting)"),
            ServiceState::Starting
        );
        assert_eq!(
            classify("running", "Up 5 hours (unhealthy)"),
            ServiceState::Unhealthy
        );
    }

    #[test]
    fn classifies_non_running_states() {
        assert_eq!(classify("restarting", "Restarting (1)"), ServiceState::Erroring);
        assert_eq!(classify("paused", "Up 2 days (Paused)"), ServiceState::Working);
        assert_eq!(classify("exited", "Exited (0) 2 days ago"), ServiceState::Stopped);
    }

    #[test]
    fn lookup_prefers_cms_prefix() {
        let states = vec![
            ("cms-database".to_string(), ServiceState::Running),
            ("other".to_string(), ServiceState::Stopped),
        ];
        assert_eq!(lookup(&states, "database"), Some(ServiceState::Running));
        assert_eq!(lookup(&states, "missing"), None);
    }
}
