//! Painting for the domain page.
//!
//! WHY rendering is separate from the form's state: the page can be read, edited and
//! submitted without a terminal, and a layout change then cannot alter what a keystroke
//! does.

use super::domain::DomainView;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

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
            format!("dry run: {plan}")
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

/// A dim explanatory line.
fn hint(text: &str) -> Paragraph<'static> {
    Paragraph::new(text.to_string()).style(Style::default().fg(Color::DarkGray))
}

/// Renders the domain page: the flag form plus the argv it currently encodes.
pub fn render(f: &mut Frame, area: Rect, view: &DomainView) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(5),
            Constraint::Length(3),
        ])
        .split(area);

    f.render_widget(title(" Domain — setup "), chunks[0]);
    view.form().render(f, chunks[1]);
    f.render_widget(plan_block(view), chunks[2]);
    f.render_widget(hint(super::domain::HELP), chunks[3]);
}
