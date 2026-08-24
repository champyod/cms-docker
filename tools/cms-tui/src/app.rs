use anyhow::Result;
use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::{Terminal, backend::CrosstermBackend};

use crate::data::snapshot::Snapshot;
use crate::keys::Action;
use crate::style::Theme;
use crate::ui;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Dashboard,
    Fleet,
}

impl Tab {
    pub fn next(self) -> Self {
        match self {
            Tab::Dashboard => Tab::Fleet,
            Tab::Fleet => Tab::Dashboard,
        }
    }
}

pub struct App {
    pub tab: Tab,
    pub theme: Theme,
    pub should_quit: bool,
    pub snapshot: Snapshot,
}

impl App {
    pub fn new(theme: Theme) -> Self {
        Self {
            tab: Tab::Dashboard,
            theme,
            should_quit: false,
            snapshot: Snapshot::empty(),
        }
    }

    pub async fn run(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> Result<()> {
        let mut poll =
            tokio::time::interval(std::time::Duration::from_secs(10));
        poll.tick().await;
        loop {
            self.snapshot = Snapshot::collect().await;
            terminal.draw(|frame| ui::render(frame, self))?;
            if !self.wait_for_input(&mut poll).await? {
                return Ok(());
            }
        }
    }

    /// Waits for either the next poll interval or user input.
    /// Returns false when the app should quit.
    async fn wait_for_input(
        &mut self,
        poll: &mut tokio::time::Interval,
    ) -> Result<bool> {
        tokio::select! {
            _ = poll.tick() => Ok(true),
            action = wait_action() => {
                match action {
                    Action::Quit => Ok(false),
                    other => {
                        self.dispatch(other);
                        Ok(true)
                    },
                }
            },
        }
    }

    fn dispatch(&mut self, action: Action) {
        match action {
            Action::Quit => self.should_quit = true,
            Action::NextTab => self.tab = self.tab.next(),
            Action::Refresh => {},
            Action::Help => {},
        }
    }
}

/// Async task that resolves with the next user action (or None on read error).
async fn wait_action() -> Action {
    loop {
        if crossterm::event::poll(std::time::Duration::from_millis(50))
            .unwrap_or(false)
        {
            if let Some(action) = poll_event() {
                return action;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

/// Non-blocking event read; returns None when no input pending.
fn poll_event() -> Option<Action> {
    if !crossterm::event::poll(std::time::Duration::from_millis(50)).ok()? {
        return None;
    }
    match crossterm::event::read().ok()? {
        Event::Key(key)
            if key.kind == KeyEventKind::Press =>
        {
            match key.code {
                KeyCode::Char('q') => Some(Action::Quit),
                KeyCode::Char('c')
                    if key
                        .modifiers
                        .contains(KeyModifiers::CONTROL) =>
                {
                    Some(Action::Quit)
                },
                KeyCode::Char('w') | KeyCode::Tab => Some(Action::NextTab),
                KeyCode::Char('r') => Some(Action::Refresh),
                KeyCode::Char('?') => Some(Action::Help),
                _ => None,
            }
        },
        _ => None,
    }
}
