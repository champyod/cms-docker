//! Which `make` targets a stack lifecycle command runs.
//!
//! Resolution is kept apart from execution so the mapping can be read — and
//! tested — without spawning anything: the CLI and the TUI both resolve through
//! these functions, which is what keeps `./cms deploy all` and the TUI's Deploy
//! All row in the same order.

/// The five make-target stacks that mirror `./cms deploy`/`stop`/`pull`.
pub const ALL_STACKS: [&str; 5] = ["core", "admin", "contest", "worker", "infra"];

/// Deploy order used by `./cms deploy all` (core first, worker last).
pub const DEPLOY_ALL_ORDER: [&str; 5] = ["core", "infra", "admin", "contest", "worker"];

/// Value that asks for every stack at once.
const ALL_STACKS_ARG: &str = "all";

/// Represents a stack lifecycle failure that is not a process error.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DockerError {
    #[error("unknown stack `{0}`: expected one of core, admin, contest, worker, infra, or all")]
    UnknownStack(String),
    #[error("no stack given: pass one of core, admin, contest, worker, infra, or all")]
    MissingStack,
}

/// Resolves deploy make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is empty or unknown.
pub fn deploy_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    if stack.is_empty() {
        return Err(DockerError::MissingStack);
    }
    if stack == ALL_STACKS_ARG {
        return Ok(DEPLOY_ALL_ORDER.iter().map(ToString::to_string).collect());
    }
    single_stack(stack)
}

/// Resolves stop make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is unknown.
pub fn stop_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    suffixed_targets(stack, "-stop")
}

/// Builds the ordered sequence of `make` targets for a clean request.
///
/// # Errors
///
/// Returns `Err` if `stack` is unknown.
pub fn clean_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    suffixed_targets(stack, "-clean")
}

/// Resolves pull make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is empty or unknown.
pub fn pull_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    if ALL_STACKS.contains(&stack) {
        return Ok(vec![format!("pull-{stack}")]);
    }
    // WHY: `pull` rebuilds every image from one target, so the all-stacks form
    // is a single target instead of one per stack.
    if stack.is_empty() || stack == ALL_STACKS_ARG {
        return Ok(vec!["pull".to_string()]);
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

/// Resolves `make <stack><suffix>` for one stack, or for every stack at once.
///
/// An empty stack resolves like `all` because every caller declares `all` as the
/// default, and clap passes the default rather than an empty value.
fn suffixed_targets(stack: &str, suffix: &str) -> Result<Vec<String>, DockerError> {
    if ALL_STACKS.contains(&stack) {
        return Ok(vec![format!("{stack}{suffix}")]);
    }
    if stack.is_empty() || stack == ALL_STACKS_ARG {
        return Ok(suffixed_all(suffix));
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

fn single_stack(stack: &str) -> Result<Vec<String>, DockerError> {
    if ALL_STACKS.contains(&stack) {
        return Ok(vec![stack.to_string()]);
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

fn suffixed_all(suffix: &str) -> Vec<String> {
    ALL_STACKS
        .iter()
        .map(|name| format!("{name}{suffix}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deploy_single_stack_maps_to_stack_target() {
        assert_eq!(deploy_targets("core").unwrap(), vec!["core"]);
        assert_eq!(deploy_targets("admin").unwrap(), vec!["admin"]);
    }

    #[test]
    fn deploy_all_uses_deploy_order() {
        let targets = deploy_targets("all").unwrap();
        assert_eq!(targets, vec!["core", "infra", "admin", "contest", "worker"]);
    }

    #[test]
    fn deploy_unknown_stack_errors() {
        assert_eq!(
            deploy_targets("bogus"),
            Err(DockerError::UnknownStack("bogus".into()))
        );
        assert_eq!(deploy_targets(""), Err(DockerError::MissingStack));
    }

    #[test]
    fn stop_maps_per_stack_and_all() {
        assert_eq!(stop_targets("core").unwrap(), vec!["core-stop"]);
        let all = stop_targets("all").unwrap();
        assert_eq!(all.len(), ALL_STACKS.len());
        assert!(all.contains(&"admin-stop".to_string()));
    }

    #[test]
    fn clean_single_maps_to_clean_target() {
        assert_eq!(clean_targets("worker").unwrap(), vec!["worker-clean"]);
    }

    #[test]
    fn clean_all_maps_to_per_stack_cleans() {
        let targets: Vec<String> = clean_targets("all").unwrap();
        assert_eq!(targets.len(), ALL_STACKS.len());
        assert_eq!(targets, suffixed_all("-clean"));
        assert!(
            !targets.iter().any(|target| target == "clean"),
            "`clean all` must never resolve to the bare `clean` target, which removes the generated .env"
        );
    }

    #[test]
    fn pull_maps_per_stack_and_all() {
        assert_eq!(pull_targets("infra").unwrap(), vec!["pull-infra"]);
        assert_eq!(pull_targets("").unwrap(), vec!["pull"]);
        assert_eq!(pull_targets("all").unwrap(), vec!["pull"]);
    }

    #[test]
    fn an_unknown_stack_is_refused_by_every_operation() {
        for resolve in [
            stop_targets as fn(&str) -> Result<Vec<String>, DockerError>,
            clean_targets,
            pull_targets,
        ] {
            assert_eq!(
                resolve("bogus"),
                Err(DockerError::UnknownStack("bogus".into()))
            );
        }
    }
}
