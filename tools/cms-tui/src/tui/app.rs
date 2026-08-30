use std::fmt;
use std::process::Command;
use std::io::{self, Write};
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen, SetTitle},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::error::Error;

#[derive(Clone, PartialEq, Debug)]
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
            Route::Dashboard => write!(f, "Dashboard"),
            Route::Actions => write!(f, "Actions & Deployment"),
            Route::Customization => write!(f, "Customization"),
            Route::Security => write!(f, "Security"),
            Route::Maintenance => write!(f, "Maintenance"),
        }
    }
}

#[derive(PartialEq, Debug, Clone)]
pub enum WorkingPopup {
    Blinking,
    TtyDropped,
}

pub struct App {
    pub route_stack: Vec<Route>,
    pub should_quit: bool,
    pub show_working_popup: bool,
    pub working_message: WorkingPopup,
    pub last_toast: Option<(String, u8)>, // (message, timeout ticks)
}

impl App {
    pub fn new() -> Self {
        Self {
            route_stack: vec![Route::Dashboard],
            should_quit: false,
            show_working_popup: false,
            working_message: WorkingPopup::Blinking,
            last_toast: None,
        }
    }

    pub fn current_route(&self) -> &Route {
        self.route_stack.last().unwrap_or(&Route::Dashboard)
    }

    pub fn push_route(&mut self, route: Route) {
        self.route_stack.push(route);
    }

    pub fn pop_route(&mut self) {
        if self.route_stack.len() > 1 {
            self.route_stack.pop();
        }
    }

    pub fn quit(&mut self) {
        self.should_quit = true;
    }
    
    // --- Core Execution Logic ---
    
    /// Runs a command, dropping to TTY for interactive or verbose output.
    pub fn run_command_in_tty(&mut self, command_str: &str) -> Result<(), Box<dyn Error>> {
        // 1. Shutdown TUI temporarily
        self.show_working_popup = true;
        self.working_message = WorkingPopup::TtyDropped;
        
        // 2. Suspend TUI
        let mut stdout = io::stdout();
        disable_raw_mode()?;
        execute!(stdout, LeaveAlternateScreen, DisableMouseCapture)?;
        drop(stdout);

        // 3. Clear screen and show a prompt
        print!("{}", "\x1b[2J\x1b[?25h"); // Clear screen, show cursor
        print!("--- Dropping to TTY for interactive command ---\n");
        print!("Command: {}\n", command_str);
        print!("--- (Press any key after command finishes to return to TUI) ---\n");
        io::stdout().flush()?;

        // 4. Execute the command, inheriting the current TTY for full I/O
        let status = if cfg!(target_os = "windows") {
            Command::new("cmd").args(["/C", command_str]).status()?
        } else {
            Command::new("sh").arg("-c").arg(command_str).status()?
        };

        // 5. Wait for user acknowledgement
        let mut input = String::new();
        let _ = io::stdin().read_line(&mut input);

        // 6. Resume TUI
        let mut stdout = io::stdout();
        enable_raw_mode()?;
        execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;

        // 7. Show toast based on status
        let success = status.success();
        let code = status.code().unwrap_or(-1);
        if success {
            self.last_toast = Some(("Command succeeded!".to_string(), 50));
        } else {
            self.last_toast = Some((format!("Command failed with code: {}", code), 50));
        }
        
        self.show_working_popup = false;
        self.working_message = WorkingPopup::Blinking;
        
        Ok(())
    }
}

pub fn run() -> Result<Terminal<CrosstermBackend<std::io::Stdout>>, Box<dyn Error>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture, SetTitle("CMS-TUI"))?;
    let backend = CrosstermBackend::new(stdout);
    let terminal = Terminal::new(backend)?;
    Ok(terminal)
}
