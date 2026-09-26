use super::runner::{RunError, Runner};

/// Executes `scripts/<script>` in the repo root and returns the exit code.
///
/// The name rule is enforced by the runner, because the runner owns the
/// `scripts/<name>` join that a name has to survive.
pub fn execute_script(script: &str, args: &[&str]) -> Result<i32, RunError> {
    let runner = Runner::new()?;
    runner.run_sh(script, args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_runs_in_repo_root_and_returns_code() {
        let code = execute_script("__preflight.sh", &[]).expect("script spawns");
        assert!(
            code == 0 || code == 2,
            "preflight ran and returned a real exit code, got {code}"
        );
    }

    #[test]
    fn execute_rejects_traversal_without_running() {
        assert!(matches!(
            execute_script("../escape.sh", &[]),
            Err(RunError::InvalidScriptName { .. })
        ));
    }
}
