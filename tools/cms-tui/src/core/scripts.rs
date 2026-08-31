use super::runner::{RunError, Runner};

/// Error for script-name validation or execution failures.
#[derive(Debug, thiserror::Error)]
pub enum ScriptError {
    #[error("invalid script name: {0}")]
    InvalidName(String),
    #[error(transparent)]
    Runner(#[from] RunError),
}

/// Rejects script names that could escape `scripts/` or smuggle CLI flags.
///
/// Allowing `..`, `/`, or a leading `-` would let an untrusted input resolve
/// outside the scripts dir or be parsed as an `sh` option.
///
/// # Errors
///
/// Returns `Err` if `script` is empty, contains traversal, or starts with `-`.
pub fn validate_script_name(script: &str) -> Result<(), ScriptError> {
    if script.is_empty() || script.contains("..") || script.contains('/') || script.starts_with('-')
    {
        return Err(ScriptError::InvalidName(script.to_string()));
    }
    Ok(())
}

/// Executes `scripts/<script>` in the repo root and returns the exit code.
///
/// # Errors
///
/// Returns `Err` if validation fails or the script fails to spawn.
pub fn execute_script(script: &str, args: &[&str]) -> Result<i32, ScriptError> {
    validate_script_name(script)?;
    let runner = Runner::new()?;
    Ok(runner.run_sh(script, args)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_plain_script_name() {
        assert!(validate_script_name("__preflight.sh").is_ok());
    }

    #[test]
    fn validate_rejects_empty_name() {
        assert!(matches!(
            validate_script_name(""),
            Err(ScriptError::InvalidName(_))
        ));
    }

    #[test]
    fn validate_rejects_path_traversal() {
        for bad in ["../scripts/x", "a/../b", "..", "../../etc/passwd"] {
            assert!(validate_script_name(bad).is_err(), "reject {bad}");
        }
    }

    #[test]
    fn validate_rejects_absolute_and_leading_dash() {
        assert!(validate_script_name("/etc/passwd").is_err());
        assert!(validate_script_name("-n").is_err());
    }

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
            Err(ScriptError::InvalidName(_))
        ));
    }
}
