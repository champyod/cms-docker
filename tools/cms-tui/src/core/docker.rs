use super::docker_targets::{
    clean_targets, deploy_targets, pull_targets, stop_targets, DockerError,
};
use super::runner::{RunError, Runner};

/// Exit code recorded for a step whose make target never started, so the step
/// reads as failed instead of as a target that reported success.
const SPAWN_FAILURE_EXIT_CODE: i32 = 1;

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
        Ok(self.run_targets(targets, &envs))
    }

    /// Stops the requested stack via `make`.
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown.
    pub fn stop(&self, stack: &str) -> Result<StepReport, DockerError> {
        Ok(self.run_targets(stop_targets(stack)?, &[]))
    }

    /// Cleans the requested stack via `make`.
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown.
    pub fn clean(&self, stack: &str) -> Result<StepReport, DockerError> {
        Ok(self.run_targets(clean_targets(stack)?, &[]))
    }

    /// Pulls images for the requested stack via `make`.
    ///
    /// # Errors
    ///
    /// Returns `Err` if `stack` is unknown.
    pub fn pull(&self, stack: &str) -> Result<StepReport, DockerError> {
        Ok(self.run_targets(pull_targets(stack)?, &[]))
    }

    /// Runs every target in order, recording one step per target.
    fn run_targets(&self, targets: Vec<String>, envs: &[(&str, &str)]) -> StepReport {
        let mut report = StepReport::default();
        for target in targets {
            let code = self
                .runner
                .run_make(&target, envs)
                .unwrap_or_else(|err| log_spawn_error(&target, &err));
            report.steps.push((target, code));
        }
        report
    }
}

/// Turns a make target that could not even be started into a failed step, with
/// the reason already on stderr so the step line is not the only evidence.
fn log_spawn_error(target: &str, err: &RunError) -> i32 {
    eprintln!("cms error: make {target} could not run: {err}");
    SPAWN_FAILURE_EXIT_CODE
}
