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
    pub needs_collect: bool,
    pub snapshot: Snapshot,
    pub fleet: crate::ui::fleet::FleetScreen,
    pub toasts: Vec<(String, std::time::Instant)>,
}

impl App {
    pub fn new(theme: Theme) -> Self {
        Self {
            tab: Tab::Dashboard,
            theme,
            should_quit: false,
            needs_collect: true,
            snapshot: Snapshot::empty(),
            fleet: Default::default(),
            toasts: Vec::new(),
        }
    }

    pub async fn run(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    ) -> Result<()> {
        let mut poll =
            tokio::time::interval(std::time::Duration::from_secs(10));
        poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        poll.tick().await;
        loop {
            if self.needs_collect {
                self.needs_collect = false;
                self.snapshot = Snapshot::collect().await;
            }
            terminal.draw(|frame| ui::render(frame, self))?;
            self.wait_for_input(&mut poll).await?;
            if self.should_quit {
                return Ok(());
            }
        }
    }

    /// Waits for either the next poll interval or user input,
    /// marking the snapshot stale when either arrives.
    async fn wait_for_input(
        &mut self,
        poll: &mut tokio::time::Interval,
    ) -> Result<()> {
        tokio::select! {
            _ = poll.tick() => self.needs_collect = true,
            action = wait_action() => self.dispatch(action),
        }
        Ok(())
    }

    pub fn toast(&mut self, message: String) {
        self.toasts.push((message, std::time::Instant::now()));
        self.toasts.retain(|(_, at)| at.elapsed() < std::time::Duration::from_secs(5));
    }

    fn dispatch(&mut self, action: Action) {
        match action {
            Action::Quit => self.should_quit = true,
            Action::NextTab => self.tab = self.tab.next(),
            Action::Refresh => self.needs_collect = true,
            Action::Help => {},
            Action::Key(code) => {
                if self.tab == Tab::Fleet {
                    self.fleet.handle_key(code);
                    if let Some(msg) = self.fleet.take_toast() {
                        self.toast(msg);
                    }
                }
            },
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
                other => Some(Action::Key(other)),
            }
        },
        _ => None,
    }
}
