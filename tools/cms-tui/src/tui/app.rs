use crate::core::model::AppState;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{
        disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen, SetTitle,
    },
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::error::Error;
use std::fmt;
use std::io::{self, Write};
use std::process::Command;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Route {
    Dashboard,
    Actions,
    Customization,
    Security,
    Maintenance,
}

impl fmt::Display for Route {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Dashboard => write!(f, "Dashboard"),
            Self::Actions => write!(f, "Actions & Deployment"),
            Self::Customization => write!(f, "Customization"),
            Self::Security => write!(f, "Security"),
            Self::Maintenance => write!(f, "Maintenance"),
        }
    }
}

#[derive(PartialEq, Eq, Debug, Clone)]
pub enum WorkingPopup {
    Blinking,
    TtyDropped,
}

pub struct App {
    route_stack: Vec<Route>,
    should_quit: bool,
    should_show_working_popup: bool,
    pub working_message: WorkingPopup,
    pub last_toast: Option<(String, u8)>, // (message, timeout ticks)
    pub state: AppState,
}

impl App {
    #[must_use]
    pub fn new() -> Self {
        Self {
            route_stack: vec![Route::Dashboard],
            should_quit: false,
            should_show_working_popup: false,
            working_message: WorkingPopup::Blinking,
            last_toast: None,
            state: AppState::new(),
        }
    }

    #[must_use]
    pub fn current_route(&self) -> &Route {
        self.route_stack.last().unwrap_or(&Route::Dashboard)
    }

    #[must_use]
    pub const fn is_quitting(&self) -> bool {
        self.should_quit
    }

    #[must_use]
    pub const fn can_pop(&self) -> bool {
        self.route_stack.len() > 1
    }

    #[must_use]
    pub const fn stack_depth(&self) -> usize {
        self.route_stack.len()
    }

    #[must_use]
    pub fn route_stack(&self) -> &[Route] {
        &self.route_stack
    }

    #[must_use]
    pub const fn should_show_working_popup(&self) -> bool {
        self.should_show_working_popup
    }

    pub fn push_route(&mut self, route: Route) {
        if self.current_route() != &route {
            self.route_stack.push(route);
        }
    }

    pub fn pop_route(&mut self) {
        if self.can_pop() {
            self.route_stack.pop();
        }
    }

    pub fn reset_to_home(&mut self) {
        self.route_stack.clear();
        self.route_stack.push(Route::Dashboard);
    }

    pub const fn quit(&mut self) {
        self.should_quit = true;
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

impl App {
    // --- Core Execution Logic ---

    /// Runs a command, dropping to TTY for interactive or verbose output.
    ///
    /// # Errors
    ///
    /// Returns `Err` if terminal mode switching or the subprocess fails.
    pub fn run_command_in_tty(&mut self, command_str: &str) -> Result<(), Box<dyn Error>> {
        self.suspend_tui()?;

        print!("\x1b[2J\x1b[?25h"); // Clear screen, show cursor
        println!("--- Dropping to TTY for interactive command ---");
        println!("Command: {command_str}");
        println!("--- (Press any key after command finishes to return to TUI) ---");
        io::stdout().flush()?;

        let status = if cfg!(target_os = "windows") {
            Command::new("cmd").args(["/C", command_str]).status()?
        } else {
            Command::new("sh").arg("-c").arg(command_str).status()?
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
}

/// Initializes the terminal for TUI mode.
///
/// # Errors
///
/// Returns `Err` if raw mode or alternate screen setup fails.
pub fn run() -> Result<Terminal<CrosstermBackend<std::io::Stdout>>, Box<dyn Error>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(
        stdout,
        EnterAlternateScreen,
        EnableMouseCapture,
        SetTitle("CMS-TUI")
    )?;
    let backend = CrosstermBackend::new(stdout);
    let terminal = Terminal::new(backend)?;
    Ok(terminal)
}

#[cfg(test)]
mod tests {
    use super::{App, Route};

    fn app() -> App {
        App::new()
    }

    #[test]
    fn starts_on_dashboard() {
        let app = app();
        assert_eq!(*app.current_route(), Route::Dashboard);
    }

    #[test]
    fn push_replaces_current_route() {
        let mut app = app();
        app.push_route(Route::Security);
        assert_eq!(*app.current_route(), Route::Security);
        assert_eq!(app.stack_depth(), 2);
    }

    #[test]
    fn push_ignores_duplicate_current_route() {
        let mut app = app();
        app.push_route(Route::Security);
        app.push_route(Route::Security);
        assert_eq!(app.stack_depth(), 2);
    }

    #[test]
    fn pop_returns_to_dashboard_but_never_empty() {
        let mut app = app();
        app.push_route(Route::Actions);
        app.push_route(Route::Maintenance);
        app.pop_route();
        assert_eq!(*app.current_route(), Route::Actions);
        app.pop_route();
        assert_eq!(*app.current_route(), Route::Dashboard);
        app.pop_route();
        assert_eq!(app.stack_depth(), 1);
    }

    #[test]
    fn reset_returns_to_single_dashboard_page() {
        let mut app = app();
        app.push_route(Route::Customization);
        app.push_route(Route::Security);
        app.reset_to_home();
        assert_eq!(app.route_stack(), &[Route::Dashboard]);
    }
}
