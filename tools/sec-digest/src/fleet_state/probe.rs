//! The one batched read-only probe each host answers, and how a host is addressed.
//!
//! It reads `uname`, the reboot marker, a simulated `apt-get upgrade`, `df`, `docker ps`
//! and the scanner's published run result — the last `security-scan[all]: rootfs:` log
//! line stands in while a host still runs an image that does not write that file — then
//! the backup metrics file if it exists. No sudo, no writes.

use std::path::{Path, PathBuf};

/// `name=user@addr[:key],…`; only the hosts listed here are probed.
pub const HOSTS_ENV: &str = "SEC_DIGEST_HOSTS";
pub const DEFAULT_HOSTS: &str = "como-main=com-o@100.114.35.41:~/.ssh/cms_deploy";
/// Hosts the inventory knows about; one with no route is named, never assumed healthy.
pub const KNOWN_HOSTS: [&str; 3] = ["cms", "admin", "ranking"];
pub const PROBE_TIMEOUT_SECS: u64 = 25;

pub const PROBE: &str = r#"
set -u
echo "kernel=$(uname -r)"
if [ -f /var/run/reboot-required ]; then echo "reboot=required"; else echo "reboot=no"; fi
sec=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c '^Inst.*security' || true)
echo "secupdates=${sec:-0}"
echo "disk=$(df -P / | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
echo "containers=$(docker ps -q 2>/dev/null | wc -l)"
echo "unhealthy=$(docker ps --filter health=unhealthy -q 2>/dev/null | wc -l)"
echo "restarting=$(docker ps --filter status=restarting -q 2>/dev/null | wc -l)"
echo "uptime=$(cut -d. -f1 /proc/uptime)"
_scan=$(docker exec cms-security-scan cat /var/cache/security-scan/scan-status.json 2>/dev/null) || _scan=$(docker logs --tail 800 cms-security-scan 2>&1 | grep 'security-scan\[all\]: rootfs:' | tail -1 | sed 's/ security-scan\[all\]: rootfs: /|/; s/ findings under .*//')
printf 'lastscan=%s\n' "$_scan"
_bkf=$(ls /srv/cms/backups/metrics/cms_backup.prom "$HOME"/cms-docker/backups/metrics/cms_backup.prom 2>/dev/null | head -1)
if [ -n "$_bkf" ]; then
  grep -E '^cms_(backup|offsite)_(stale|last_success_timestamp_seconds)' "$_bkf" | head -4
fi
_dump=$(ls -t "$HOME"/cms-docker/backups/db/*.dump 2>/dev/null | head -1)
if [ -n "$_dump" ]; then
  echo "cms_backup_dump_age_days=$(( ( $(date +%s) - $(stat -c %Y "$_dump") ) / 86400 ))"
else
  echo "cms_backup_not_reported=1"
fi
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostSpec {
    pub name: String,
    pub target: String,
    pub key: Option<PathBuf>,
}

/// `name=user@addr[:key]`; an entry with no `=` keeps the whole text as the target.
pub fn parse_hosts(raw: &str) -> Vec<HostSpec> {
    let mut hosts = Vec::new();
    for entry in raw.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let (name, target) = match entry.split_once('=') {
            Some((name, target)) => (name.trim(), target.trim()),
            None => ("", entry),
        };
        let (userhost, key) = match target.split_once(':') {
            Some((userhost, key)) if !key.is_empty() => (userhost, Some(expand_user(key))),
            _ => (target, None),
        };
        let label = if name.is_empty() { userhost } else { name };
        hosts.push(HostSpec {
            name: label.to_string(),
            target: userhost.to_string(),
            key,
        });
    }
    hosts
}

/// `~/x` becomes `$HOME/x`; anything else is left exactly as configured.
fn expand_user(path: &str) -> PathBuf {
    if path == "~" {
        return home();
    }
    match path.strip_prefix("~/") {
        Some(rest) => home().join(rest),
        None => PathBuf::from(path),
    }
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new("/").to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_name_target_and_key() {
        let hosts =
            parse_hosts("como-main=com-o@100.114.35.41:~/.ssh/cms_deploy, admin=root@10.0.0.9");
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "como-main");
        assert_eq!(hosts[0].target, "com-o@100.114.35.41");
        assert!(hosts[0]
            .key
            .as_deref()
            .is_some_and(|key| key.ends_with(".ssh/cms_deploy")));
        assert_eq!(hosts[1].name, "admin");
        assert_eq!(hosts[1].key, None);
    }

    #[test]
    fn the_default_host_is_the_production_one() {
        let hosts = parse_hosts(DEFAULT_HOSTS);
        assert_eq!(hosts[0].name, "como-main");
        assert_eq!(hosts[0].target, "com-o@100.114.35.41");
    }

    #[test]
    fn an_entry_without_a_name_is_labelled_by_its_target() {
        let hosts = parse_hosts("root@10.0.0.9");
        assert_eq!(hosts[0].name, "root@10.0.0.9");
    }

    #[test]
    fn the_probe_script_reads_its_facts_without_writing_any() {
        assert!(PROBE.starts_with("\nset -u\necho \"kernel=$(uname -r)\""));
        assert!(PROBE.contains("cms_backup.prom"));
        // A host whose metrics file lives elsewhere still answers: dump age, or NOT REPORTED.
        // Silent was the bug — a path that does not exist on this host read as "nothing wrong".
        assert!(PROBE.contains("cms_backup_dump_age_days"));
        assert!(PROBE.contains("cms_backup_not_reported=1"));
        assert!(!PROBE.contains("sudo"));
        // The result file first, the log line only as the fallback: a container that is gone
        // must still read as NOT REPORTED rather than as a clean run.
        let file_read = PROBE
            .find("scan-status.json")
            .expect("reads the result file");
        let log_fallback = PROBE
            .find("docker logs --tail 800 cms-security-scan")
            .expect("falls back to the log");
        assert!(file_read < log_fallback);
        assert!(PROBE.contains("|| _scan=$(docker logs"));
    }
}
