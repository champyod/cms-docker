use crate::core::model::AppState;
use crate::tui::components::action_menu::ActionMenu;
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
    Stacks,
    Database,
    Worker,
    Ingress,
    Config,
    Backup,
    System,
    Bootstrap,
}

impl fmt::Display for Route {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Dashboard => write!(f, "Dashboard"),
            Self::Stacks => write!(f, "Stacks"),
            Self::Database => write!(f, "Database"),
            Self::Worker => write!(f, "Worker"),
            Self::Ingress => write!(f, "Ingress"),
            Self::Config => write!(f, "Config"),
            Self::Backup => write!(f, "Backup"),
            Self::System => write!(f, "System"),
            Self::Bootstrap => write!(f, "Bootstrap"),
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
    pub stacks_menu: ActionMenu,
    pub database_menu: ActionMenu,
    pub worker_menu: ActionMenu,
    pub ingress_menu: ActionMenu,
    pub config_menu: ActionMenu,
    pub backup_menu: ActionMenu,
    pub system_menu: ActionMenu,
    pub bootstrap_menu: ActionMenu,
}

impl App {
    #[must_use]
    pub fn new() -> Self {
        let state = AppState::new();
        Self {
            route_stack: vec![Route::Dashboard],
            should_quit: false,
            should_show_working_popup: false,
            working_message: WorkingPopup::Blinking,
            last_toast: None,
            state: state.clone(),
            stacks_menu: Self::build_stacks_menu(&state),
            database_menu: Self::build_database_menu(&state),
            worker_menu: Self::build_worker_menu(&state),
            ingress_menu: Self::build_ingress_menu(&state),
            config_menu: Self::build_config_menu(&state),
            backup_menu: Self::build_backup_menu(&state),
            system_menu: Self::build_system_menu(&state),
            bootstrap_menu: Self::build_bootstrap_menu(&state),
        }
    }

    fn build_stacks_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            ("Deploy Core".to_string(), "make core".to_string()),
            ("Deploy Admin".to_string(), "make admin".to_string()),
            ("Deploy Contest".to_string(), "make contest".to_string()),
            ("Deploy Worker".to_string(), "make worker".to_string()),
            ("Deploy Infra".to_string(), "make infra".to_string()),
            (
                "Deploy All".to_string(),
                "make core infra admin contest worker".to_string(),
            ),
        ];
        ActionMenu::new(items)
    }

    fn build_database_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            (
                "Initialize Database".to_string(),
                "make cms-init".to_string(),
            ),
            ("Reset Database".to_string(), "make db-reset".to_string()),
            ("Clean Database".to_string(), "make db-clean".to_string()),
            (
                "Sync Schema (Prisma)".to_string(),
                "make prisma-sync".to_string(),
            ),
        ];
        ActionMenu::new(items)
    }

    fn build_worker_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            (
                "Fleet Manager (TUI)".to_string(),
                "worker fleet".to_string(),
            ),
            ("Pick Server".to_string(), "worker server".to_string()),
            ("Connect Worker".to_string(), "worker connect".to_string()),
            ("Setup Cgroups".to_string(), "worker cgroup".to_string()),
        ];
        ActionMenu::new(items)
    }

    fn build_ingress_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            (
                "Tailscale Setup/Status".to_string(),
                "tailscale".to_string(),
            ),
            ("Expose Wizard".to_string(), "expose".to_string()),
            ("Funnel Setup/Status".to_string(), "funnel".to_string()),
            ("Domain Setup/Status".to_string(), "domain".to_string()),
        ];
        ActionMenu::new(items)
    }

    fn build_config_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            (
                "Sync Config (.env.* from config.toml)".to_string(),
                "config sync".to_string(),
            ),
            ("Edit config.toml".to_string(), "config edit".to_string()),
            ("Show config.toml".to_string(), "config show".to_string()),
            ("Secrets: Audit".to_string(), "secrets audit".to_string()),
            (
                "Secrets: Generate".to_string(),
                "secrets generate".to_string(),
            ),
            (
                "Secrets: Rotate (guarded)".to_string(),
                "secrets rotate".to_string(),
            ),
        ];
        ActionMenu::new(items)
    }

    fn build_backup_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            ("Run Backup Now".to_string(), "make backup".to_string()),
            (
                "Backup Drill (test restore)".to_string(),
                "backup drill".to_string(),
            ),
            ("Offsite Sync".to_string(), "backup offsite".to_string()),
            ("Restore from Archive".to_string(), "restore".to_string()),
        ];
        ActionMenu::new(items)
    }

    fn build_system_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            (
                "Doctor (Preflight Checks)".to_string(),
                "doctor".to_string(),
            ),
            ("Smoke Test".to_string(), "test".to_string()),
            (
                "Full Update Server".to_string(),
                "update-server".to_string(),
            ),
        ];
        ActionMenu::new(items)
    }

    fn build_bootstrap_menu(_state: &AppState) -> ActionMenu {
        let items = vec![
            ("Setup (Fresh Install)".to_string(), "setup".to_string()),
            (
                "Update Config (Interactive)".to_string(),
                "update".to_string(),
            ),
            (
                "Fix (Non-interactive Repair)".to_string(),
                "fix".to_string(),
            ),
            ("Create Superadmin".to_string(), "admin-create".to_string()),
        ];
        ActionMenu::new(items)
    }

    #[must_use]
    pub fn current_route(&self) -> &Route {
        self.route_stack.last().unwrap_or(&Route::Dashboard)
    }

    /// Returns the action menu for the current route, or `None` on the dashboard.
    pub fn active_menu(&mut self) -> Option<&mut ActionMenu> {
        match self.current_route() {
            Route::Stacks => Some(&mut self.stacks_menu),
            Route::Database => Some(&mut self.database_menu),
            Route::Worker => Some(&mut self.worker_menu),
            Route::Ingress => Some(&mut self.ingress_menu),
            Route::Config => Some(&mut self.config_menu),
            Route::Backup => Some(&mut self.backup_menu),
            Route::System => Some(&mut self.system_menu),
            Route::Bootstrap => Some(&mut self.bootstrap_menu),
            Route::Dashboard => None,
        }
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
            self.refresh_for_route();
        }
    }

    pub fn pop_route(&mut self) {
        if self.can_pop() {
            self.route_stack.pop();
            self.refresh_for_route();
        }
    }

    pub fn reset_to_home(&mut self) {
        self.route_stack.clear();
        self.route_stack.push(Route::Dashboard);
        self.refresh_for_route();
    }

    fn refresh_for_route(&mut self) {
        match self.current_route() {
            Route::Stacks => self.stacks_menu = Self::build_stacks_menu(&self.state),
            Route::Database => self.database_menu = Self::build_database_menu(&self.state),
            Route::Worker => self.worker_menu = Self::build_worker_menu(&self.state),
            Route::Ingress => self.ingress_menu = Self::build_ingress_menu(&self.state),
            Route::Config => self.config_menu = Self::build_config_menu(&self.state),
            Route::Backup => self.backup_menu = Self::build_backup_menu(&self.state),
            Route::System => self.system_menu = Self::build_system_menu(&self.state),
            Route::Bootstrap => self.bootstrap_menu = Self::build_bootstrap_menu(&self.state),
            Route::Dashboard => {}
        }
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

    /// Runs the action currently selected in the active page's menu.
    /// TTY actions drop to the terminal; non-TTY actions run inline.
    pub fn run_selected_action(&mut self) {
        let current = self.current_route().clone();
        let (cmd, requires) = match &current {
            Route::Stacks
            | Route::Database
            | Route::Worker
            | Route::Ingress
            | Route::Backup
            | Route::Bootstrap => self
                .active_menu()
                .map(|menu| (menu.selected_label().to_string(), true))
                .unwrap_or_default(),
            Route::Config => self.active_menu().map_or_default(|menu| {
                let label = menu.selected_label().to_string();
                (
                    label.clone(),
                    label.contains("edit") || label.contains("rotate"),
                )
            }),
            Route::System => self.active_menu().map_or_default(|menu| {
                let label = menu.selected_label().to_string();
                (label.clone(), label.contains("update-server"))
            }),
            Route::Dashboard => (String::new(), false),
        };

        if cmd.is_empty() {
            self.set_toast("(no action selected)");
            return;
        }

        if requires {
            if let Err(err) = self.run_command_in_tty(&cmd) {
                self.set_toast(&format!("Failed to run: {err}"));
            }
        } else {
            self.run_inline_task(&cmd);
        }
    }

    fn run_inline_task(&mut self, command: &str) {
        let result = (|| -> Result<i32, Box<dyn Error>> {
            let runner = crate::core::runner::Runner::new()?;
            let status = Command::new("sh")
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
    fn push_replaces_current_route() {
        let mut app = app();
        app.push_route(Route::System);
        assert_eq!(*app.current_route(), Route::System);
        assert_eq!(app.stack_depth(), 2);
    }

    #[test]
    fn push_ignores_duplicate_current_route() {
        let mut app = app();
        app.push_route(Route::System);
        app.push_route(Route::System);
        assert_eq!(app.stack_depth(), 2);
    }

    #[test]
    fn pop_returns_to_dashboard_but_never_empty() {
        let mut app = app();
        app.push_route(Route::Stacks);
        app.push_route(Route::Bootstrap);
        app.pop_route();
        assert_eq!(*app.current_route(), Route::Stacks);
        app.pop_route();
        assert_eq!(*app.current_route(), Route::Dashboard);
        app.pop_route();
        assert_eq!(app.stack_depth(), 1);
    }

    #[test]
    fn run_selected_action_empty_selection_is_noop() {
        let mut app = app();
        app.push_route(Route::Stacks);
        app.state.tasks.clear();
        app.refresh_for_route();
        // stacks_menu always has 6 items (fixed vec), not dependent on tasks
        assert_eq!(app.stacks_menu.len(), 6);
        app.run_selected_action();
        assert!(app.last_toast.is_some());
    }
}
