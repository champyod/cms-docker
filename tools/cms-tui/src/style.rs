use anyhow::Result;
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode,
    enable_raw_mode,
};
use ratatui::{Terminal, backend::CrosstermBackend};

/// Theme colors: btop-dark defaults (bg 235, fg 252, accent 196).
pub struct Theme {
    pub bg: ratatui::style::Color,
    pub fg: ratatui::style::Color,
    pub accent: ratatui::style::Color,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            bg: ratatui::style::Color::Indexed(235),
            fg: ratatui::style::Color::Indexed(252),
            accent: ratatui::style::Color::Indexed(196),
        }
    }
}

pub fn init_terminal(
) -> Result<Terminal<CrosstermBackend<std::io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    crossterm::execute!(
        stdout,
        EnterAlternateScreen,
        EnableMouseCapture
    )?;
    let backend = CrosstermBackend::new(stdout);
    Ok(Terminal::new(backend)?)
}

pub fn restore_terminal() -> Result<()> {
    let mut stdout = std::io::stdout();
    crossterm::execute!(
        stdout,
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    disable_raw_mode()?;
    Ok(())
}
