//! How a service name is spelled as a command line, in both directions.

/// `log-service` → `LogService`, so both the Python and the binary spelling key one report entry.
#[must_use]
pub(super) fn camel_case(kebab: &str) -> Option<String> {
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

/// `LogService` → `cms-log-service`: the inverse of [`camel_case`], for a process to be started.
///
/// The spawn side and the matcher must agree, or autorestart starts a command its own next scan
/// cannot recognise and starts a second copy every pass. A name with no such spelling is refused
/// rather than started, because the only thing worse than not restarting a service is a fork bomb.
#[must_use]
pub(super) fn binary_name(service: &str) -> Option<String> {
    if service.is_empty() {
        return None;
    }
    let mut name = String::from("cms-");
    for (index, character) in service.char_indices() {
        if character.is_ascii_uppercase() {
            if index > 0 {
                name.push('-');
            }
            name.push(character.to_ascii_lowercase());
        } else if character.is_ascii_lowercase() && index > 0 {
            name.push(character);
        } else {
            return None;
        }
    }
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::{binary_name, camel_case};

    #[test]
    fn a_service_name_is_spelled_as_a_binary_name() {
        assert_eq!(
            binary_name("LogService").as_deref(),
            Some("cms-log-service")
        );
        assert_eq!(
            binary_name("ContestWebServer").as_deref(),
            Some("cms-contest-web-server")
        );
        assert_eq!(binary_name("Checker").as_deref(), Some("cms-checker"));
    }

    #[test]
    fn a_name_with_no_kebab_spelling_is_refused() {
        assert_eq!(binary_name("Worker2"), None);
        assert_eq!(binary_name("worker"), None);
        assert_eq!(binary_name(""), None);
        assert_eq!(binary_name("Worker_1"), None);
    }

    #[test]
    fn the_two_spellings_invert_each_other() {
        for service in [
            "LogService",
            "ResourceService",
            "ProxyService",
            "ScoringService",
            "EvaluationService",
            "ContestWebServer",
            "AdminWebServer",
            "Checker",
            "Worker",
        ] {
            let binary = binary_name(service).expect("a CMS service name has a binary name");
            let kebab = binary
                .strip_prefix("cms-")
                .expect("the prefix is added here");
            assert_eq!(camel_case(kebab).as_deref(), Some(service));
        }
    }
}
