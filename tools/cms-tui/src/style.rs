use anyhow::Result;
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode,
    enable_raw_mode,
};
use ratatui::{Terminal, backend::CrosstermBackend};

/// Theme colors: btop-dark defaults (bg 235, fg 252, accent 196)
/// plus status palette (ok 114, err 203, warn 214, dim 244).
pub struct Theme {
    pub fg: ratatui::style::Color,
    pub accent: ratatui::style::Color,
    pub ok: ratatui::style::Color,
    pub err: ratatui::style::Color,
    pub warn: ratatui::style::Color,
    pub dim: ratatui::style::Color,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            fg: ratatui::style::Color::Indexed(252),
            accent: ratatui::style::Color::Indexed(196),
            ok: ratatui::style::Color::Indexed(114),
            err: ratatui::style::Color::Indexed(203),
            warn: ratatui::style::Color::Indexed(214),
            dim: ratatui::style::Color::Indexed(244),
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
