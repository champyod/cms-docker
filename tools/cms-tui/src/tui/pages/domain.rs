//! Domain setup page — a form for `__domain.sh setup`, reached from Ingress.
//!
//! WHY a form rather than the hardcoded `setup --cert letsencrypt` menu entry it
//! replaced: every other flag that decision implies — staging, DNS-01, retry policy,
//! the live `--apply` switch — used to be unreachable from the TUI, so the only way to
//! set them was to leave the TUI and remember the CLI spelling. One table now drives
//! both the display and the argv.
//!
//! WHY revocation is absent entirely: it is irreversible, and a mis-aimed keystroke on a
//! form with twenty rows is a much easier accident than a typed subcommand. `revoke`
//! stays a CLI-only verb.

use super::domain_fields::APPLY_LABEL;
use super::domain_request::{argv, wants_apply};
use super::domain_values::form_from_disk;
use crate::tui::components::config_form::ConfigForm;
use crossterm::event::KeyCode;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};
use std::path::Path;

/// What a key press asked the form to do.
#[derive(Debug, PartialEq, Eq)]
pub enum DomainAction {
    /// Stay on the page; the keystroke only moved focus or edited a row.
    Edited,
    /// Arm the live run, which needs a second key to confirm.
    Arming,
    /// Arming was confirmed and the script should be launched.
    Confirmed,
    /// Arming was abandoned; the form is back to a dry run.
    Cancelled,
    /// The operator asked to run the (dry-run or confirmed) plan.
    Submit,
    /// Leave the form.
    Back,
    /// Nothing this page owns.
    Ignored,
}

/// The domain form and the two-step arming of a live run.
///
/// WHY a separate `is_arming` state instead of letting Space flip `--apply` directly: a
/// live run reissues certificates and reloads nginx, and the operator has to be able to
/// see that this run is live before it starts. One deliberate key opens the question, a
/// second answers it.
pub struct DomainView {
    form: ConfigForm,
    is_arming: bool,
    last_argv: Vec<String>,
}

impl DomainView {
    /// Builds the form from what this box currently has configured.
    #[must_use]
    pub fn from_disk(repo_root: &Path) -> Self {
        Self::new(form_from_disk(repo_root))
    }

    #[must_use]
    pub const fn new(form: ConfigForm) -> Self {
        Self {
            form,
            is_arming: false,
            last_argv: Vec::new(),
        }
    }

    #[must_use]
    pub const fn form(&self) -> &ConfigForm {
        &self.form
    }

    /// The form itself, so a caller can move focus before handing it a keystroke.
    pub const fn form_mut(&mut self) -> &mut ConfigForm {
        &mut self.form
    }

    /// Whether the live-run question is open and waiting for a yes.
    #[must_use]
    pub const fn is_arming(&self) -> bool {
        self.is_arming
    }

    /// Whether the form is currently describing a live run rather than a dry run.
    #[must_use]
    pub fn is_apply(&self) -> bool {
        wants_apply(&self.form)
    }

    /// The exact argv this form would hand the script right now.
    ///
    /// WHY rendered on the page: the operator is about to run something that reissues a
    /// certificate, and the flags it will pass should be readable before it does rather
    /// than discovered in a log afterwards.
    #[must_use]
    pub fn preview(&self) -> String {
        argv(&self.form).join(" ")
    }

    /// Handles one key press on the form.
    ///
    /// Returns [`DomainAction::Ignored`] for keys that belong to another page, so the
    /// caller can fall through instead of swallowing them.
    pub fn handle_key(&mut self, key: KeyCode) -> DomainAction {
        if self.is_arming {
            return self.handle_arming_key(key);
        }
        match key {
            KeyCode::Char('a' | 'A') if self.is_on_apply_row() => self.arm(),
            KeyCode::Char('r' | 'R') => DomainAction::Submit,
            KeyCode::Esc => DomainAction::Back,
            KeyCode::Enter | KeyCode::Down | KeyCode::Up | KeyCode::Tab | KeyCode::BackTab => {
                self.form.handle_key(key);
                DomainAction::Edited
            }
            _ if is_typing_key(key) => {
                self.form.handle_key(key);
                DomainAction::Edited
            }
            _ => DomainAction::Ignored,
        }
    }

    /// The live-run question: only `y` arms it, and anything else steps back.
    fn handle_arming_key(&mut self, key: KeyCode) -> DomainAction {
        self.is_arming = false;
        match key {
            KeyCode::Char('y' | 'Y') => {
                self.set_apply(true);
                DomainAction::Confirmed
            }
            _ => DomainAction::Cancelled,
        }
    }

    /// Opens the live-run question, or reports that the row is already armed.
    fn arm(&mut self) -> DomainAction {
        if self.is_apply() {
            self.set_apply(false);
            return DomainAction::Cancelled;
        }
        self.is_arming = true;
        DomainAction::Arming
    }

    /// Records the argv a run used, so the page can show what was actually launched.
    pub fn note_run(&mut self, args: Vec<String>) {
        self.last_argv = args;
    }

    /// The argv of the last run on this form.
    #[must_use]
    pub fn last_run(&self) -> &[String] {
        &self.last_argv
    }

    fn is_on_apply_row(&self) -> bool {
        self.form.is_focused_row(APPLY_LABEL)
    }

    fn set_apply(&mut self, is_on: bool) {
        if is_on != self.is_apply() {
            self.form.flip_row(APPLY_LABEL);
        }
    }
}

/// Whether `key` is a character a text or integer row could accept.
///
/// WHY Home, the arrows and Backspace are excluded here: they navigate or edit, and a
/// form row that swallowed them would make the page's own bindings unreachable.
const fn is_typing_key(key: KeyCode) -> bool {
    matches!(key, KeyCode::Char(_) | KeyCode::Backspace)
}

/// Renders the domain form page.
pub fn render(f: &mut Frame, area: Rect, view: &DomainView) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(2),
            Constraint::Min(0),
            Constraint::Length(5),
            Constraint::Length(3),
        ])
        .split(area);

    f.render_widget(title(" Domain — setup "), chunks[0]);
    f.render_widget(hint(MODE_HINT), chunks[1]);
    view.form.render(f, chunks[2]);
    f.render_widget(plan_block(view), chunks[3]);
    f.render_widget(hint(HELP), chunks[4]);
}

const MODE_HINT: &str = " DRY RUN — nothing is written until --apply is armed with 'a' then 'y'.";

const HELP: &str =
    "[↑/↓/Tab] Row   [Space] Toggle   [a] Arm live run   [r] Run   [Esc] Back   [1-9] Page   [q] Quit";

/// The bottom panel: either the live-run question or the argv that would be sent.
fn plan_block(view: &DomainView) -> Paragraph<'static> {
    let (text, color) = if view.is_arming() {
        (
            " This will run LIVE and reissue certificates. Press 'y' to arm --apply, \
             anything else to cancel. "
                .to_string(),
            Color::Red,
        )
    } else {
        let plan = format!(" will run: {}", view.preview());
        let plan = if view.is_apply() {
            format!("LIVE {plan}")
        } else {
            format!("dry-run{plan}")
        };
        (
            plan,
            if view.is_apply() {
                Color::Red
            } else {
                Color::Green
            },
        )
    };
    Paragraph::new(text)
        .style(Style::default().fg(color).add_modifier(Modifier::BOLD))
        .block(Block::default().borders(Borders::ALL).title(" plan "))
}

/// A bordered heading line.
fn title(text: &str) -> Paragraph<'static> {
    Paragraph::new(text.to_string())
        .style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .block(Block::default().borders(Borders::ALL))
}

/// A dim, unbordered explanatory line.
fn hint(text: &str) -> Paragraph<'static> {
    Paragraph::new(text.to_string()).style(Style::default().fg(Color::DarkGray))
}
