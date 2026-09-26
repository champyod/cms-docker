use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

/// Reported when a child was killed by a signal, which leaves it without an
/// exit code of its own. Any non-zero value keeps the step marked as failed.
const SIGNALLED_EXIT_CODE: i32 = -1;

/// Why a script name is refused before it is joined onto `scripts/`.
const SCRIPT_NAME_RULE: &str = "a name may not be empty, contain '/' or '..', or start with '-'";

/// Error type for subprocess execution failures.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error(
        "CMS repository root not found: no directory above the executable or the current \
         directory holds both `cms` and `Makefile`. Run this from inside a CMS checkout."
    )]
    RepoRootMissing,
    #[error(
        "`scripts/{script}` is missing from the CMS repository root. Check the command name, \
         then run `./cms doctor` to verify the checkout."
    )]
    ScriptMissing { script: String },
    #[error("`{program}` could not be started: {source}. Check that make and bash are on PATH.")]
    Spawn {
        program: String,
        #[source]
        source: std::io::Error,
    },
    #[error("`{command}` exited with code {code}")]
    NonZero { command: String, code: i32 },
    #[error("invalid script name `{name}`: {rule}")]
    InvalidScriptName { name: String, rule: &'static str },
}

/// Rejects script names that could resolve outside `scripts/` or be read as a
/// `bash` option.
///
/// The rule sits here rather than at the callers because this module owns the
/// `scripts/<name>` join, so every path into the runner is covered by it.
pub fn validate_script_name(script: &str) -> Result<(), RunError> {
    if script.is_empty() || script.contains("..") || script.contains('/') || script.starts_with('-')
    {
        return Err(RunError::InvalidScriptName {
            name: script.to_string(),
            rule: SCRIPT_NAME_RULE,
        });
    }
    Ok(())
}

/// Executes `make`/`sh` commands with the repo root as the working directory.
///
/// The CMS tooling assumes a stable repo layout (a `cms` script and `Makefile`
/// at the git root). Resolving the repo root once and reusing it keeps every
/// spawned command consistent and avoids fragile relative-path failures when
/// running from the crate directory.
pub struct Runner {
    cwd: PathBuf,
}

impl Runner {
    /// Creates a runner rooted at the CMS repository root.
    ///
    /// Walks up from the executable (vendored under `.tools/cms-tui/` in the
    /// deployed repo) and then from the current working directory until a
    /// `Makefile` + `cms` are found; errors otherwise so callers fail fast
    /// rather than run in the wrong dir.
    ///
    /// # Errors
    ///
    /// Returns [`RunError::RepoRootMissing`] if the repo root markers are not
    /// found.
    pub fn new() -> Result<Self, RunError> {
        let root = Self::detect_repo_root().ok_or(RunError::RepoRootMissing)?;
        Ok(Self { cwd: root })
    }

    /// Runs `make <target>` in the repo root and reports its exit code.
    ///
    /// The code is returned rather than raised as an error so a caller that
    /// drives several targets in sequence can report each one.
    ///
    /// # Errors
    ///
    /// Returns [`RunError::Spawn`] if `make` fails to start.
    pub fn run_make(&self, target: &str, envs: &[(&str, &str)]) -> Result<i32, RunError> {
        let mut cmd = Command::new("make");
        cmd.current_dir(&self.cwd).arg(target);
        for (key, value) in envs {
            cmd.env(key, value);
        }
        let status = cmd.status().map_err(|source| RunError::Spawn {
            program: "make".into(),
            source,
        })?;
        Ok(exit_code(status))
    }

    /// Runs `make <target>` and turns a non-zero exit into a typed error that
    /// names the target, so the report says which step failed.
    ///
    /// # Errors
    ///
    /// Returns [`RunError::NonZero`] if `make` reports a failing exit code, or
    /// [`RunError::Spawn`] if it fails to start.
    pub fn run_make_checked(&self, target: &str, envs: &[(&str, &str)]) -> Result<(), RunError> {
        let code = self.run_make(target, envs)?;
        if code != 0 {
            return Err(RunError::NonZero {
                command: format!("make {target}"),
                code,
            });
        }
        Ok(())
    }

    /// Runs `scripts/<script>` via `bash` in the repo root and reports its exit
    /// code.
    ///
    /// All `scripts/__*.sh` are bash (shebang, arrays, `local`); spawning a
    /// POSIX `sh` instead aborts fatally on a failed `source` and would break
    /// entirely on dash-only systems.
    ///
    /// # Errors
    ///
    /// Returns [`RunError::InvalidScriptName`] for a name that could escape
    /// `scripts/`, [`RunError::ScriptMissing`] when the file is absent — which
    /// `bash` would otherwise report as an exit 127 that reads like a bug in
    /// the script — and [`RunError::Spawn`] if `bash` fails to start.
    pub fn run_sh(&self, script: &str, args: &[&str]) -> Result<i32, RunError> {
        validate_script_name(script)?;
        let script_path = self.cwd.join("scripts").join(script);
        if !script_path.is_file() {
            return Err(RunError::ScriptMissing {
                script: script.to_string(),
            });
        }
        let mut cmd = Command::new("bash");
        cmd.current_dir(&self.cwd)
            .arg(&script_path)
            .args(args)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        let status = cmd.status().map_err(|source| RunError::Spawn {
            program: script_path.display().to_string(),
            source,
        })?;
        Ok(exit_code(status))
    }

    #[must_use]
    pub fn repo_root(&self) -> &Path {
        &self.cwd
    }

    /// Resolves the repo root from runtime paths only: the executable
    /// location first (covers the vendored deployment), then the current
    /// working directory (covers `cargo run`/test builds inside the repo).
    /// Compile-time paths are never used — they would bake the build
    /// machine's layout into released binaries.
    fn detect_repo_root() -> Option<PathBuf> {
        if let Some(exe_dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        {
            if let Some(root) = Self::find_repo_root(&exe_dir) {
                return Some(root);
            }
        }
        let cwd = std::env::current_dir().ok()?;
        Self::find_repo_root(&cwd)
    }

    /// Walks up from `start` to the first directory containing both a `Makefile`
    /// and a `cms` entry (the two artifacts that mark the repo root).
    fn find_repo_root(start: &Path) -> Option<PathBuf> {
        let mut dir = start;
        loop {
            if dir.join("Makefile").is_file() && dir.join("cms").exists() {
                return Some(dir.to_path_buf());
            }
            dir = dir.parent()?;
        }
    }
}

/// Maps a finished child onto the exit code the caller reports.
///
/// A child killed by a signal reports no code of its own; any non-zero value
/// keeps the step marked as failed instead of silently looking successful.
#[must_use]
pub fn exit_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(SIGNALLED_EXIT_CODE)
}

#[cfg(test)]
#[path = "runner_tests.rs"]
mod tests;
