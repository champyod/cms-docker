//! The command-line rule that decides which process is a CMS service.

use std::collections::BTreeMap;
use std::path::Path;

use super::coord::{LocalService, ServiceCoord};
use crate::resource::{ProcessFacts, ReadError, ResourceReader};

/// The service a command line names, and the shard it was given, if any.
pub type Matched = (String, Option<i32>);

/// The processes whose command lines name a CMS service, by service name and then shard.
#[derive(Debug, Default)]
pub struct ProcessMatcher {
    found: BTreeMap<String, BTreeMap<Option<i32>, ProcessFacts>>,
}

impl ProcessMatcher {
    /// Reads every pid once and keeps the ones whose command line names a service.
    ///
    /// # Errors
    ///
    /// [`ReadError`] when the pid list or one process the caller may read cannot be read;
    /// a pid that vanished between the two reads is skipped, as `_get_all_processes` skips it.
    pub fn scan(reader: &dyn ResourceReader, bin_path: &Path) -> Result<Self, ReadError> {
        let mut found: BTreeMap<String, BTreeMap<Option<i32>, ProcessFacts>> = BTreeMap::new();
        for pid in reader.pids()? {
            let facts = match reader.process(pid) {
                Ok(facts) => facts,
                Err(ReadError::NotFound) => continue,
                Err(error) => return Err(error),
            };
            if let Some((name, shard)) = interesting_command_line(&facts.cmd, bin_path) {
                found.entry(name).or_default().insert(shard, facts);
            }
        }
        Ok(Self { found })
    }

    /// The process for `service`, if one command line named it on this machine.
    #[must_use]
    pub fn find(&self, service: &ServiceCoord, local: &[LocalService]) -> Option<&ProcessFacts> {
        self.found
            .get(service.name())?
            .iter()
            .find_map(|(shard, facts)| names_shard(*shard, service, local).then_some(facts))
    }
}

/// Whether a parsed shard belongs to `service`, resolving a default the way the config would.
fn names_shard(shard: Option<i32>, service: &ServiceCoord, local: &[LocalService]) -> bool {
    match shard {
        Some(shard) => shard == service.shard(),
        // WHY: Python resolves a missing shard through the config, so with only the local list an answer exists only when one shard carries the name.
        None => {
            local
                .iter()
                .filter(|s| s.coord.name() == service.name())
                .count()
                == 1
                && local.iter().any(|s| s.coord == *service)
        }
    }
}

/// Parses a command line into the service it names, if it names one.
///
/// The Python rule is `ResourceService.py:119-159`; the binary rule is the same service after
/// the migration, and both run during the transition.
#[must_use]
pub fn interesting_command_line(command: &[String], bin_path: &Path) -> Option<Matched> {
    let start = if command
        .first()
        .is_some_and(|first| basename(first) == Some("env"))
    {
        1
    } else {
        0
    };
    let program = command.get(start)?;
    if program.contains("python") {
        let script = command.get(start + 1)?;
        let name = script_service_name(script, bin_path)?;
        return Some((name, shard_from(command, start + 2)));
    }
    // WHY: a rule that only knew "python" would find nothing once the services are Rust binaries.
    let name = binary_service_name(program, bin_path)?;
    Some((name, shard_from(command, start + 1)))
}

/// `<bin_path>/cms<Name>`: the script `python` runs, named for the service.
fn script_service_name(script: &str, bin_path: &Path) -> Option<String> {
    let path = Path::new(script);
    if path.parent()? != bin_path {
        return None;
    }
    let name = path.file_name()?.to_str()?.strip_prefix("cms")?;
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(name.to_owned())
}

/// `<bin_path>/cms-<name>`: the Rust binary, whose name inverts to the Python service name.
fn binary_service_name(program: &str, bin_path: &Path) -> Option<String> {
    let path = Path::new(program);
    if path.parent()? != bin_path {
        return None;
    }
    camel_case(path.file_name()?.to_str()?.strip_prefix("cms-")?)
}

/// `log-service` → `LogService`, so both forms key the same report entry.
fn camel_case(kebab: &str) -> Option<String> {
    let mut name = String::new();
    for segment in kebab.split('-') {
        if segment.is_empty() || !segment.chars().all(|c| c.is_ascii_lowercase()) {
            return None;
        }
        let mut characters = segment.chars();
        name.push(characters.next()?.to_ascii_uppercase());
        name.extend(characters);
    }
    Some(name)
}

/// The first all-digit argument two apart from `from`, as the shard scan reads the options.
fn shard_from(command: &[String], from: usize) -> Option<i32> {
    (from..command.len())
        .step_by(2)
        .find(|index| {
            !command[*index].is_empty() && command[*index].chars().all(|c| c.is_ascii_digit())
        })
        .and_then(|index| command[index].parse().ok())
}

/// The file name of an argument, or [`None`] when it has no readable one.
fn basename(argument: &str) -> Option<&str> {
    Path::new(argument).file_name()?.to_str()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::interesting_command_line;

    const BIN: &str = "/opt/cms/bin";

    fn words(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn matched(command: &[&str]) -> Option<(String, Option<i32>)> {
        interesting_command_line(&words(command), Path::new(BIN))
    }

    #[test]
    fn the_python_script_form_is_recognised() {
        assert_eq!(
            matched(&[
                "/usr/local/bin/python3",
                "/opt/cms/bin/cmsLogService",
                "1",
                "-c",
                "7",
            ]),
            Some(("LogService".to_owned(), Some(1)))
        );
    }

    #[test]
    fn the_rust_binary_form_is_recognised() {
        assert_eq!(
            matched(&["/opt/cms/bin/cms-log-service", "2", "-c", "7"]),
            Some(("LogService".to_owned(), Some(2)))
        );
        assert_eq!(
            matched(&["/opt/cms/bin/cms-contest-web-server"]),
            Some(("ContestWebServer".to_owned(), None))
        );
    }

    #[test]
    fn an_env_prefix_is_skipped() {
        assert_eq!(
            matched(&[
                "/usr/bin/env",
                "python3",
                "/opt/cms/bin/cmsProxyService",
                "0",
            ]),
            Some(("ProxyService".to_owned(), Some(0)))
        );
        assert_eq!(
            matched(&["env", "/opt/cms/bin/cms-worker", "3"]),
            Some(("Worker".to_owned(), Some(3)))
        );
    }

    #[test]
    fn a_command_line_that_is_not_a_cms_service_is_rejected() {
        assert_eq!(matched(&[]), None);
        assert_eq!(matched(&["/usr/local/bin/python3"]), None);
        assert_eq!(
            matched(&["/usr/local/bin/python3", "/home/user/cmsLogService"]),
            None
        );
        assert_eq!(
            matched(&["/usr/local/bin/python3", "/opt/cms/bin/cms.py"]),
            None
        );
        assert_eq!(matched(&["/opt/cms/bin/cmsgrep", "1"]), None);
        assert_eq!(
            matched(&["/usr/bin/other", "/opt/cms/bin/cmsLogService"]),
            None
        );
    }

    #[test]
    fn the_shard_is_the_first_number_two_apart() {
        assert_eq!(
            matched(&["python3", "/opt/cms/bin/cmsWorker", "-c", "7", "4",])
                .map(|(_, shard)| shard),
            Some(Some(4))
        );
        assert_eq!(
            matched(&["python3", "/opt/cms/bin/cmsWorker", "-c", "ALL"]).map(|(_, shard)| shard),
            Some(None)
        );
    }
}
