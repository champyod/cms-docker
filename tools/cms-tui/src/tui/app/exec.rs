use super::route::{Route, WorkingPopup};
use super::state::App;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use std::error::Error;
use std::io::{self, Write};
use std::process::Command;

impl App {
    /// Runs a command, dropping to TTY for interactive output.
    ///
    /// # Errors
    ///
    /// Returns `Err` if terminal mode switching or the subprocess fails.
    pub fn run_command_in_tty(&mut self, command: &str) -> Result<(), Box<dyn Error>> {
        self.suspend_tui()?;

        print!("\x1b[2J\x1b[?25h");
        println!("--- Dropping to TTY for interactive command ---");
        println!("Command: {command}");
        println!("--- (Press any key after command finishes to return to TUI) ---");
        io::stdout().flush()?;

        let status = if cfg!(target_os = "windows") {
            Command::new("cmd").args(["/C", command]).status()?
        } else {
            Command::new("bash").arg("-c").arg(command).status()?
        };

        let mut input = String::new();
        let _ = io::stdin().read_line(&mut input);

        Self::resume_tui()?;
        self.show_command_result(status.success(), status.code().unwrap_or(-1));

        Ok(())
    }

    fn suspend_tui(&mut self) -> io::Result<()> {
        self.should_show_working_popup = true;
        self.working_message = WorkingPopup::TtyDropped;

        let mut stdout = io::stdout();
        disable_raw_mode()?;
        execute!(stdout, LeaveAlternateScreen, DisableMouseCapture)
    }

    fn resume_tui() -> io::Result<()> {
        let mut stdout = io::stdout();
        enable_raw_mode()?;
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)
    }

    fn show_command_result(&mut self, success: bool, code: i32) {
        self.last_toast = Some(if success {
            ("Command succeeded!".to_string(), 50)
        } else {
            (format!("Command failed with code: {code}"), 50)
        });
        self.should_show_working_popup = false;
        self.working_message = WorkingPopup::Blinking;
    }

    /// Runs the action currently selected in the active page's menu.
    pub fn run_selected_action(&mut self) {
        let (cmd, requires_tty, capture_output) = self
            .active_menu()
            .map(|menu| {
                let item = menu.get_item(menu.selected());
                (
                    menu.selected_command().to_string(),
                    item.is_some_and(|item| item.requires_tty),
                    item.is_some_and(|item| item.capture_output),
                )
            })
            .unwrap_or_default();

        if cmd.is_empty() {
            self.set_toast("(no action selected)");
            return;
        }

        if requires_tty {
            if let Err(err) = self.run_command_in_tty(&cmd) {
                self.set_toast(&format!("Failed to run: {err}"));
            }
        } else if capture_output {
            self.run_captured_task(&cmd);
        } else {
            self.run_inline_task(&cmd);
        }
    }

    fn run_captured_task(&mut self, command: &str) {
        let result = (|| -> Result<(i32, String), Box<dyn Error>> {
            let runner = crate::core::runner::Runner::new()?;
            let output = Command::new("bash")
                .current_dir(runner.repo_root())
                .arg("-c")
                .arg(command)
                .output()?;
            let code = output.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = if stderr.trim().is_empty() {
                stdout.into_owned()
            } else if stdout.trim().is_empty() {
                stderr.into_owned()
            } else {
                format!("{stdout}\n{stderr}")
            };
            Ok((code, combined))
        })();
        match result {
            Ok((code, combined)) => {
                self.feed_output(&combined, code);
            }
            Err(err) => self.set_toast(&format!("Failed to run: {err}")),
        }
    }

    fn feed_output(&mut self, combined: &str, code: i32) {
        let text = combined.trim_end();
        // Keep output in the log viewer so it survives the next frame paint.
        if text.is_empty() {
            self.log_viewer.append("(no output)");
        } else {
            for line in text.lines() {
                self.log_viewer.append(line);
            }
        }
        let summary = if code == 0 {
            "Command succeeded — press L to view output"
        } else {
            "Command finished with output — press L to view"
        };
        self.set_toast(summary);
        self.push_route(Route::Logs);
    }

    fn run_inline_task(&mut self, command: &str) {
        let result = (|| -> Result<i32, Box<dyn Error>> {
            let runner = crate::core::runner::Runner::new()?;
            let status = Command::new("bash")
                .current_dir(runner.repo_root())
                .arg("-c")
                .arg(command)
                .status()?;
            Ok(status.code().unwrap_or(-1))
        })();
        match result {
            Ok(0) => self.set_toast("Command succeeded!"),
            Ok(code) => self.set_toast(&format!("Command failed with code: {code}")),
            Err(err) => self.set_toast(&format!("Failed to run: {err}")),
        }
    }

    fn set_toast(&mut self, message: &str) {
        self.last_toast = Some((message.to_string(), 50));
    }
}
