use super::runner::{RunError, Runner};

/// The five make-target stacks that mirror `./cms deploy`/`stop`/`pull`.
pub const ALL_STACKS: [&str; 5] = ["core", "admin", "contest", "worker", "infra"];

/// Additive stacks that publish host ports and are excluded from `all`.
///
/// WHY excluded from `all`: `domain` binds host 80/443 and starts certbot, and
/// `waf` adds the `ModSecurity` profile in front of it. A workstation running
/// `make core` must not acquire a public listener or begin ACME issuance, so
/// these are opt-in by name rather than part of the blanket rollout.
pub const ADDITIVE_STACKS: [&str; 2] = ["domain", "waf"];

/// Deploy order used by `./cms deploy all` (core first, worker last).
const DEPLOY_ALL_ORDER: [&str; 5] = ["core", "infra", "admin", "contest", "worker"];

/// Represents a stack lifecycle failure that is not a process error.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DockerError {
    #[error("unknown stack: {0}")]
    UnknownStack(String),
    #[error("missing stack argument")]
    MissingStack,
}

/// Outcome of a multi-target operation (e.g. `deploy all`).
#[derive(Debug, Default)]
pub struct StepReport {
    pub steps: Vec<(String, i32)>,
}

impl StepReport {
    #[must_use]
    pub fn is_success(&self) -> bool {
        self.steps.iter().all(|(_, code)| *code == 0)
    }
}

/// Executes docker-stack lifecycle operations by delegating to `make`.
///
/// The mapping reproduces the verified `./cms` dispatch exactly so the Rust
/// CLI and the legacy bash orchestration stay behaviorally identical.
pub struct DockerClient {
    runner: Runner,
}

impl DockerClient {
    /// Creates a client rooted at the CMS repo.
    ///
    /// # Errors
    ///
    /// Returns `Err` if the CMS repo root cannot be located.
    pub fn new() -> Result<Self, RunError> {
        Ok(Self {
            runner: Runner::new()?,
        })
    }

    /// Deploys the requested stack via `make`.
    ///
    /// Contest deploys recreate the web server, so a successful contest
    /// deploy refreshes nginx through the shared script (parity with `make`).
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown or empty.
    pub fn deploy(&self, stack: &str, img: bool) -> Result<StepReport, DockerError> {
        let envs: Vec<(&str, &str)> = if img {
            vec![("DEPLOYMENT_TYPE_OVERRIDE", "img")]
        } else {
            vec![]
        };
        let targets = deploy_targets(stack)?;
        let mut report = StepReport::default();
        for target in targets {
            let code = self
                .runner
                .run_make(&target, &envs)
                .unwrap_or_else(|err| log_spawn_error(&target, &err));
            report.steps.push((target, code));
        }
        if matches!(stack, "contest" | "all") && report.is_success() {
            let code = self
                .runner
                .run_sh("__contest_dns_refresh.sh", &[])
                .unwrap_or_else(|err| log_spawn_error("nginx-refresh", &err));
            report.steps.push(("nginx-refresh".to_string(), code));
        }
        Ok(report)
    }

    /// Stops the requested stack via `make`.
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown.
    pub fn stop(&self, stack: &str) -> Result<StepReport, DockerError> {
        let targets = stop_targets(stack)?;
        Ok(self.run_targets(targets))
    }

    /// Cleans the requested stack via `make`.
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown.
    pub fn clean(&self, stack: &str) -> Result<StepReport, DockerError> {
        let targets = clean_targets(stack)?;
        Ok(self.run_targets(targets))
    }

    /// Pulls images for the requested stack via `make`.
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown.
    pub fn pull(&self, stack: &str) -> Result<StepReport, DockerError> {
        let targets = pull_targets(stack)?;
        Ok(self.run_targets(targets))
    }

    fn run_targets(&self, targets: Vec<String>) -> StepReport {
        let mut report = StepReport::default();
        for target in targets {
            let code = self
                .runner
                .run_make(&target, &[])
                .unwrap_or_else(|err| log_spawn_error(&target, &err));
            report.steps.push((target, code));
        }
        report
    }
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
    if stack == "all" {
        return Ok(DEPLOY_ALL_ORDER.iter().map(ToString::to_string).collect());
    }
    if ALL_STACKS.contains(&stack) || ADDITIVE_STACKS.contains(&stack) {
        return Ok(vec![stack.to_string()]);
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

/// Resolves stop make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is unknown.
pub fn stop_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    if stack.is_empty() || stack == "all" {
        return Ok(ALL_STACKS.iter().map(|s| format!("{s}-stop")).collect());
    }
    if ALL_STACKS.contains(&stack) || ADDITIVE_STACKS.contains(&stack) {
        return Ok(vec![format!("{stack}-stop")]);
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

/// Builds the ordered sequence of `make` targets for a clean request.
///
/// # Errors
///
/// Returns `Err` if `stack` is unknown.
pub fn clean_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    if stack.is_empty() || stack == "all" {
        return Ok(ALL_STACKS.iter().map(|s| format!("{s}-clean")).collect());
    }
    if ALL_STACKS.contains(&stack) || ADDITIVE_STACKS.contains(&stack) {
        return Ok(vec![format!("{stack}-clean")]);
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

/// Resolves pull make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is empty or unknown.
pub fn pull_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    if stack.is_empty() || stack == "all" {
        return Ok(vec!["pull".to_string()]);
    }
    if ALL_STACKS.contains(&stack) {
        return Ok(vec![format!("pull-{stack}")]);
    }
    // WHY no `pull-domain` / `pull-waf`: both stacks run stock upstream images
    // (nginx:alpine, certbot/certbot, redis:7-alpine, owasp/modsecurity-crs) that
    // carry no build context, so there is nothing for this repo to pull. Their
    // images refresh on `docker compose up`, not through this path.
    Err(DockerError::UnknownStack(stack.to_string()))
}

fn log_spawn_error(target: &str, err: &RunError) -> i32 {
    eprintln!("cms-tui error: make {target} failed to spawn: {err}");
    1
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
        assert_eq!(all.len(), 5);
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
        assert_eq!(
            targets,
            ALL_STACKS
                .iter()
                .map(|s| format!("{s}-clean"))
                .collect::<Vec<String>>()
        );
        assert!(
            !targets.iter().any(|t| t == "clean"),
            "`clean all` must never resolve to the bare `clean` target, which removes the generated .env"
        );
    }

    #[test]
    fn pull_maps_per_stack_and_all() {
        assert_eq!(pull_targets("infra").unwrap(), vec!["pull-infra"]);
        assert_eq!(pull_targets("").unwrap(), vec!["pull"]);
    }
}

#[cfg(test)]
mod additive_stack_tests {
    use super::{
        clean_targets, deploy_targets, pull_targets, stop_targets, ADDITIVE_STACKS, ALL_STACKS,
    };

    #[test]
    fn additive_stacks_deploy_and_stop() {
        for s in ADDITIVE_STACKS {
            assert_eq!(deploy_targets(s).unwrap(), vec![s.to_string()]);
            assert_eq!(stop_targets(s).unwrap(), vec![format!("{s}-stop")]);
            assert_eq!(clean_targets(s).unwrap(), vec![format!("{s}-clean")]);
        }
    }

    #[test]
    fn pull_rejects_additive_stacks() {
        for s in ADDITIVE_STACKS {
            assert!(pull_targets(s).is_err());
        }
    }

    #[test]
    fn all_excludes_additive_stacks() {
        let all = deploy_targets("all").unwrap();
        for s in ADDITIVE_STACKS {
            assert!(
                !all.contains(&s.to_string()),
                "deploy all must not include {s}"
            );
        }
        let stops = stop_targets("all").unwrap();
        assert_eq!(stops.len(), ALL_STACKS.len());
        assert!(!stops.contains(&"domain-stop".to_string()));
    }
}
