//! Domain form key handling and launching `__domain.sh`.
//!
//! WHY running a script is a separate step from encoding its argv: the page can describe a
//! plan all day without touching the box, and the only moment that becomes a write is an
//! explicit submit. Keeping that boundary here leaves the form's state and rendering free
//! of process spawning.
//!
//! WHY the argv is handed to the script as a vector rather than joined into a `bash -c`
//! string: the form takes free text for `--deploy-hook`, `--cert-path` and
//! `--extra-domains`, and each of those would be re-parsed by a shell as syntax. Passed
//! separately, a value like `a; id` is one argument rather than two commands. This is the
//! same path the command line takes.

use super::state::App;
use crate::core::catalog::SCRIPT_DOMAIN;
use crate::tui::pages::domain::DomainAction;
use crate::tui::pages::domain_request::argv;
use ratatui::crossterm::event::KeyCode;
use std::error::Error;
use std::process::Stdio;

/// What the event loop should do with a key the domain page consumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainKeyOutcome {
    Edited,
    Arming,
    Confirmed,
    Cancelled,
    Submit,
    Back,
    Ignored,
}

impl From<DomainAction> for DomainKeyOutcome {
    fn from(action: DomainAction) -> Self {
        match action {
            DomainAction::Edited => Self::Edited,
            DomainAction::Arming => Self::Arming,
            DomainAction::Confirmed => Self::Confirmed,
            DomainAction::Cancelled => Self::Cancelled,
            DomainAction::Submit => Self::Submit,
            DomainAction::Back => Self::Back,
            DomainAction::Ignored => Self::Ignored,
        }
    }
}

impl App {
    /// Handles one key press on the domain form.
    pub fn handle_domain_key(&mut self, key: KeyCode) -> DomainKeyOutcome {
        self.domain.handle_key(key).into()
    }

    /// Runs the plan the form currently describes.
    ///
    /// A dry run spawns nothing: it reports the argv it would run. The only thing a spawned dry
    /// run could add is a child process, and this page has no terminal to show one — the
    /// terminal is inherited only by the live path, so an operator would have to leave the form
    /// to read what a dry run printed.
    ///
    /// # Errors
    ///
    /// Returns `Err` only from an armed run, when the repository root cannot be resolved or
    /// the script cannot start. A dry run reports its toast and cannot fail.
    pub fn run_domain_form(&mut self) -> Result<(), Box<dyn Error>> {
        let args = argv(self.domain.form(), self.domain.verb());
        let is_live = self.domain.is_apply();
        self.domain.note_run(args.clone());
        if is_live {
            return self.run_live_domain_form(&args);
        }
        self.run_dry_domain_form(&args);
        Ok(())
    }

    /// Runs the script for real, with the terminal inherited so certbot can report progress.
    fn run_live_domain_form(&mut self, args: &[String]) -> Result<(), Box<dyn Error>> {
        let runner = crate::core::runner::Runner::new()?;
        let script = runner.repo_root().join("scripts").join(SCRIPT_DOMAIN);
        let status = std::process::Command::new("bash")
            .current_dir(runner.repo_root())
            .arg(&script)
            .args(args)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()?;
        self.set_toast(&format!(
            "{} finished with status {}",
            self.domain.verb(),
            crate::core::runner::exit_code(status)
        ));
        Ok(())
    }

    /// Reports the plan a dry run would execute, without running anything.
    fn run_dry_domain_form(&mut self, args: &[String]) {
        self.set_toast(&format!(
            "dry run — nothing changed: scripts/{SCRIPT_DOMAIN} {}",
            args.join(" ")
        ));
    }
}

#[cfg(test)]
#[path = "domain_keys_tests.rs"]
mod tests;
