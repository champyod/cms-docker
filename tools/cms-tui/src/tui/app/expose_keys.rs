//! Exposure chooser key handling and applying a chosen mode.
//!
//! WHY applying is a separate step from choosing: a mode is a write to `.env`, and a
//! keystroke that silently rewrites a bind address is how a box ends up reachable from
//! the whole LAN. The operator selects a mode, sees the URL it implies, and presses
//! Enter to write it.

use super::route::Route;
use super::state::App;
use crate::core::expose::{bind_address_for, Mode};
use crate::core::expose_input::{parse_port, parse_tailscale_ip};
use crossterm::event::KeyCode;
use std::io::Write;

/// What a key press asked the chooser to do.
#[derive(Debug, PartialEq, Eq)]
pub enum ExposureAction {
    /// Stay on the page; the state already changed.
    Handled,
    /// The operator pressed Enter on a selectable mode.
    Apply,
    /// Leave the chooser.
    Back,
    /// Nothing this page owns.
    Ignored,
}

impl App {
    /// Handles one key press on the exposure chooser.
    ///
    /// Returns [`ExposureAction::Ignored`] for keys that belong to another page, so the
    /// caller can fall through instead of swallowing them.
    pub fn handle_exposure_key(&mut self, key: KeyCode) -> ExposureAction {
        match key {
            KeyCode::Left | KeyCode::Char('h') => {
                self.exposure.prev_ui();
                ExposureAction::Handled
            }
            KeyCode::Right | KeyCode::Char('l') => {
                self.exposure.next_ui();
                ExposureAction::Handled
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.exposure.prev_mode();
                ExposureAction::Handled
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.exposure.next_mode();
                ExposureAction::Handled
            }
            KeyCode::Enter => ExposureAction::Apply,
            KeyCode::Esc => ExposureAction::Back,
            _ => ExposureAction::Ignored,
        }
    }

    /// Applies the chooser's current mode to the `.env` files.
    ///
    /// # Errors
    ///
    /// Returns a message naming the file and key when the write fails, so the toast
    /// says which value did not land rather than only that something did not.
    pub fn apply_exposure_choice(&mut self) -> Result<String, String> {
        let mode = self.exposure.mode();
        if let Some(reason) = self.exposure.block_reason(mode) {
            return Err(reason);
        }
        let spec = self.exposure.ui();
        let address = bind_address_for(mode, self.exposure.tailscale_ip())
            .ok_or_else(|| "Tailscale is not running — no address to bind to".to_string())?;

        let previous = read_env_value(spec.env_file, spec.bind_key);
        write_env_value(spec.env_file, spec.bind_key, &address)?;
        self.exposure.set_mode(mode);

        // WHY the mode is remembered as well as written: the bind address alone cannot
        // distinguish `local` from `ts-https`, and the chooser needs the distinction to
        // know whether to show or remove the `tailscale serve` entry.
        self.exposure.set_serve_active(mode == Mode::TsHttps);

        Ok(format!(
            "{spec}: {} → {mode} ({address} on port {})",
            if previous.is_empty() {
                "unset"
            } else {
                previous.as_str()
            },
            spec.default_port
        ))
    }

    /// Prompts for a published port and stores the validated value.
    ///
    /// # Errors
    ///
    /// Returns the validation message when the typed port is not usable.
    pub fn prompt_expose_port(&mut self) -> Result<String, String> {
        let spec = self.exposure.ui();
        print!(
            "  Published port for {} [{}]: ",
            spec.name, spec.default_port
        );
        std::io::stdout().flush().ok();
        let mut line = String::new();
        std::io::stdin()
            .read_line(&mut line)
            .map_err(|err| format!("could not read the port: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(format!("{} keeps port {}", spec.name, spec.default_port));
        }
        let port = parse_port(trimmed)?;
        write_env_value(spec.env_file, spec.port_key, &port.to_string())?;
        Ok(format!("{} → port {port}", spec.name))
    }

    /// Prompts for a Tailscale IP and stores the validated value.
    ///
    /// # Errors
    ///
    /// Returns the validation message when the typed address is not a tailnet address.
    pub fn prompt_expose_tailscale_ip(&mut self) -> Result<String, String> {
        print!("  Tailscale IP (blank to skip): ");
        std::io::stdout().flush().ok();
        let mut line = String::new();
        std::io::stdin()
            .read_line(&mut line)
            .map_err(|err| format!("could not read the address: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok("no Tailscale IP set".to_string());
        }
        let address = parse_tailscale_ip(trimmed)?;
        self.exposure.set_tailscale_ip(Some(address.to_string()));
        Ok(format!("Tailscale IP = {address}"))
    }

    /// Returns to the Ingress page from the chooser.
    pub fn leave_exposure(&mut self) {
        if self.can_pop() {
            self.pop_route();
        } else {
            self.push_route(Route::Ingress);
        }
    }
}

/// Reads a key from a dotenv-style file, returning an empty string when absent.
///
/// # Errors
///
/// None: a missing file or missing key is a normal state, not a failure.
#[must_use]
pub fn read_env_value(path: &str, key: &str) -> String {
    let Ok(content) = std::fs::read_to_string(path) else {
        return String::new();
    };
    content
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            let (name, value) = trimmed.split_once('=')?;
            (name.trim() == key).then(|| value.trim().to_string())
        })
        .unwrap_or_default()
}

/// Writes a key into a dotenv-style file, appending it when absent.
///
/// # Errors
///
/// Returns a message naming the file and key when the file cannot be written.
pub fn write_env_value(path: &str, key: &str, value: &str) -> Result<(), String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let mut out = String::with_capacity(existing.len() + value.len() + key.len() + 2);
    let mut replaced = false;

    for line in existing.lines() {
        let name = line.split_once('=').map(|(head, _)| head.trim());
        if name == Some(key) {
            out.push_str(key);
            out.push('=');
            out.push_str(value);
            out.push('\n');
            replaced = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !replaced {
        out.push_str(key);
        out.push('=');
        out.push_str(value);
        out.push('\n');
    }
    std::fs::write(path, out).map_err(|err| format!("could not write {path}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::{read_env_value, write_env_value, ExposureAction};
    use crate::tui::app::{App, Route};
    use crossterm::event::KeyCode;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cms_expose_{name}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir.join(".env.test")
    }

    /// An `App` whose exposure chooser is pinned to a known host state.
    ///
    /// WHY the exposure view is replaced rather than left to `App::new`: that call
    /// probes the live tailnet and the live domain proxy, so on a developer's box the
    /// set of selectable modes would depend on what happens to be running. Pinning it
    /// keeps the cursor assertions below about cursor movement only.
    fn app_with_unblocked_modes() -> App {
        let mut app = App::new();
        app.exposure = crate::tui::pages::expose::ExposureView::new(false, true, None);
        app
    }

    #[test]
    fn arrow_keys_move_the_two_cursors_separately() {
        let mut app = app_with_unblocked_modes();
        app.push_route(Route::Exposure);
        let start_ui = app.exposure.ui().name;

        app.handle_exposure_key(KeyCode::Right);
        assert_ne!(app.exposure.ui().name, start_ui, "Right moved the UI");

        let ui = app.exposure.ui().name;
        let mode_before = app.exposure.mode();
        app.handle_exposure_key(KeyCode::Down);
        assert_eq!(app.exposure.ui().name, ui, "Down left the UI alone");
        assert_ne!(app.exposure.mode(), mode_before, "Down moved the mode");
    }

    #[test]
    fn enter_asks_to_apply_and_escape_goes_back() {
        let mut app = App::new();
        app.push_route(Route::Exposure);
        assert_eq!(
            app.handle_exposure_key(KeyCode::Enter),
            ExposureAction::Apply
        );
        assert_eq!(app.handle_exposure_key(KeyCode::Esc), ExposureAction::Back);
    }

    #[test]
    fn keys_belonging_to_other_pages_are_ignored() {
        let mut app = App::new();
        app.push_route(Route::Exposure);
        assert_eq!(
            app.handle_exposure_key(KeyCode::Char('q')),
            ExposureAction::Ignored
        );
        assert_eq!(
            app.handle_exposure_key(KeyCode::Char('1')),
            ExposureAction::Ignored
        );
    }

    #[test]
    fn writing_a_new_key_appends_it() {
        let path = scratch("append");
        std::fs::write(&path, "A=1\nB=2\n").expect("seed");
        write_env_value(path.to_str().unwrap(), "C", "3").expect("write");
        assert_eq!(read_env_value(path.to_str().unwrap(), "C"), "3");
        assert_eq!(read_env_value(path.to_str().unwrap(), "A"), "1");
    }

    #[test]
    fn writing_an_existing_key_replaces_it_in_place() {
        let path = scratch("replace");
        std::fs::write(&path, "A=1\nB=2\nC=3\n").expect("seed");
        write_env_value(path.to_str().unwrap(), "B", "127.0.0.1").expect("write");
        let content = std::fs::read_to_string(&path).expect("read");
        assert_eq!(content, "A=1\nB=127.0.0.1\nC=3\n");
    }

    #[test]
    fn a_missing_file_reads_as_empty() {
        let path = scratch("missing");
        let _ = std::fs::remove_file(&path);
        assert_eq!(read_env_value(path.to_str().unwrap(), "ANY"), "");
    }
}
