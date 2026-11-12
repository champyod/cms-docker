//! One batched ssh per configured host, parsed into the facts the brief prints.
//!
//! A host that times out, refuses the key or has no route is `__error__` text and
//! reaches the brief as `UNREACHABLE`; nothing here can quietly return health.

use std::time::Duration;

use crate::fleet_state::exec::Runner;
use crate::fleet_state::parse_probe;
use crate::fleet_state::probe::{HostSpec, PROBE, PROBE_TIMEOUT_SECS};
use crate::fleet_state::ServerProbe;
use crate::text::take_chars;

/// The ssh argv; the script is last so it cannot be read as the host.
pub fn ssh_argv(spec: &HostSpec) -> Vec<String> {
    let mut argv: Vec<String> = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o"]
        .iter()
        .map(|part| (*part).to_string())
        .collect();
    argv.push("StrictHostKeyChecking=accept-new".to_string());
    if let Some(key) = &spec.key {
        argv.push("-i".to_string());
        argv.push(key.to_string_lossy().to_string());
    }
    argv.push(spec.target.clone());
    argv.push(PROBE.to_string());
    argv
}

pub fn server_state(runner: &dyn Runner, hosts: &[HostSpec]) -> Vec<ServerProbe> {
    let timeout = Duration::from_secs(PROBE_TIMEOUT_SECS);
    hosts
        .iter()
        .map(|spec| {
            let text = runner.run(&ssh_argv(spec), None, timeout);
            let mut probe = parse_probe(&spec.name, &text);
            if probe.error.is_none() && probe.kernel.is_none() {
                probe.error = Some(no_answer(&text));
            }
            probe
        })
        .collect()
}

/// The script prints `kernel=` first, so its absence means the remote never ran it.
fn no_answer(text: &str) -> String {
    let last = text.lines().map(str::trim).rfind(|line| !line.is_empty());
    match last {
        Some(line) => take_chars(line, 120),
        None => "no output from probe".to_string(),
    }
}

/// Known hosts with no route: named in the brief rather than assumed healthy.
pub fn uncovered(probed: &[ServerProbe]) -> Vec<String> {
    crate::fleet_state::probe::KNOWN_HOSTS
        .iter()
        .filter(|known| !known.contains("como-main"))
        .filter(|known| !probed.iter().any(|probe| probe.host == **known))
        .map(|known| (*known).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::path::PathBuf;

    struct One(String);

    impl Runner for One {
        fn run(&self, _argv: &[String], _cwd: Option<&Path>, _timeout: Duration) -> String {
            self.0.clone()
        }
    }

    fn spec() -> HostSpec {
        HostSpec {
            name: "como-main".to_string(),
            target: "com-o@100.114.35.41".to_string(),
            key: Some(PathBuf::from("/home/op/.ssh/cms_deploy")),
        }
    }

    #[test]
    fn the_ssh_command_carries_the_key_and_the_script() {
        let argv = ssh_argv(&spec());
        assert_eq!(argv[0], "ssh");
        assert!(argv
            .windows(2)
            .any(|w| w == ["-i", "/home/op/.ssh/cms_deploy"]));
        assert_eq!(argv[argv.len() - 2], "com-o@100.114.35.41");
        assert!(argv[argv.len() - 1].contains("uname -r"));
    }

    #[test]
    fn a_probe_that_errors_is_kept_as_an_error() {
        let probes = server_state(
            &One("__error__ TimeoutExpired: ssh timed out after 25s".into()),
            &[spec()],
        );
        assert_eq!(probes[0].host, "como-main");
        assert!(probes[0]
            .error
            .as_deref()
            .unwrap_or("")
            .contains("TimeoutExpired"));
    }

    #[test]
    fn stderr_without_a_probe_answer_is_unreachable_not_healthy() {
        let text = "ssh: connect to host 10.0.0.9 port 22: Connection timed out".to_string();
        let probes = server_state(&One(text), &[spec()]);
        assert_eq!(
            probes[0].error.as_deref(),
            Some("ssh: connect to host 10.0.0.9 port 22: Connection timed out")
        );
    }

    #[test]
    fn an_empty_probe_says_so() {
        let probes = server_state(&One(String::new()), &[spec()]);
        assert_eq!(probes[0].error.as_deref(), Some("no output from probe"));
    }
}
