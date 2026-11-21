//! Domain form key handling and launching `__domain.sh`.
//!
//! WHY running a script is a separate step from encoding its argv: `DomainView` can
//! describe a plan all day without touching the box, and the only moment that turns into
//! a write is an explicit submit. Keeping that boundary here means the page's rendering
//! and the form's state stay free of process spawning.
//!
//! WHY the argv is handed to the runner as a vector rather than joined into a `bash -c`
//! string: the form takes free text for `--deploy-hook`, `--cert-path` and
//! `--extra-domains`, and every one of those would be re-parsed by the shell as syntax.
//! Passing argv separately means a value like `a; id` is one argument named `a; id`
//! rather than two commands. This is the same path the CLI takes.

use super::state::App;
use crate::core::catalog::SCRIPT_DOMAIN;
use crate::core::runner::Runner;
use crate::tui::pages::domain::DomainAction;
use crate::tui::pages::domain_request::request;
use crossterm::event::KeyCode;
use std::error::Error;
use std::process::{Command, Stdio};

impl App {
    /// Handles one key press on the domain form.
    pub fn handle_domain_key(&mut self, key: KeyCode) -> DomainAction {
        self.domain.handle_key(key)
    }

    /// Runs the plan the form currently describes.
    ///
    /// # Errors
    ///
    /// Returns the subprocess or terminal error when a live run cannot be started.
    pub fn run_domain_setup(&mut self) -> Result<(), Box<dyn Error>> {
        let args =
            crate::core::domain_setup::domain_setup_args("setup", &request(self.domain.form()));
        let is_live = self.domain.is_apply();
        self.domain.note_run(args.clone());
        if is_live {
            return self.run_live_domain_setup(&args);
        }
        self.run_dry_domain_setup(&args);
        Ok(())
    }

    /// Runs the script for real, with the terminal attached so certbot can ask.
    ///
    /// # Errors
    ///
    /// Returns the subprocess error when the run cannot be started.
    fn run_live_domain_setup(&mut self, args: &[String]) -> Result<(), Box<dyn Error>> {
        let runner = Runner::new()?;
        let script = runner.repo_root().join("scripts").join(SCRIPT_DOMAIN);
        let status = Command::new("bash")
            .current_dir(runner.repo_root())
            .arg(&script)
            .args(args)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()?;
        self.set_toast(&format!(
            "setup finished with status {}",
            status.code().unwrap_or(-1)
        ));
        Ok(())
    }

    /// Reports the plan a dry run would execute, without running anything.
    fn run_dry_domain_setup(&mut self, args: &[String]) {
        self.set_toast(&format!(
            "dry run — nothing changed: scripts/{SCRIPT_DOMAIN} {}",
            args.join(" ")
        ));
    }

    /// Returns to the Ingress page from the domain form.
    pub fn leave_domain(&mut self) {
        if self.can_pop() {
            self.pop_route();
        } else {
            self.push_route(super::route::Route::Ingress);
        }
    }
}

#[cfg(test)]
#[path = "domain_keys_tests.rs"]
mod tests;
