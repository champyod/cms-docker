//! Shared widgets: status dots, panel frames, text helpers.

use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Block;

use crate::data::docker::ServiceState;
use crate::style::Theme;

/// Dot glyph + palette color for a service/worker state.
pub fn dot(state: ServiceState, theme: &Theme) -> (&'static str, ratatui::style::Color) {
    match state {
        ServiceState::Running => ("●", theme.ok),
        ServiceState::Stopped => ("○", theme.dim),
        ServiceState::Erroring | ServiceState::Unhealthy => ("✗", theme.err),
        ServiceState::Starting | ServiceState::Working => ("⠿", theme.warn),
    }
}

/// Panel frame with accent title and theme background.
pub fn panel(title: &str, theme: &Theme) -> Block<'static> {
    Block::default()
        .title(format!(" {title} "))
        .title_style(Style::new().fg(theme.accent))
        .style(Style::new().fg(theme.fg))
        .borders(ratatui::widgets::Borders::ALL)
}

/// `● name` line colored by state; dimmed placeholder when absent.
pub fn status_line(name: &str, state: Option<ServiceState>, theme: &Theme) -> Line<'static> {
    match state {
        Some(state) => {
            let (glyph, color) = dot(state, theme);
            Line::from(vec![
                Span::styled(format!("{glyph} "), Style::new().fg(color)),
                Span::raw(name.to_string()),
            ])
        },
        None => Line::from(Span::styled(
            format!("○ {name}"),
            Style::new().fg(theme.dim),
        )),
    }
}

/// Plain dim informational line.
pub fn dim_line(text: &str, theme: &Theme) -> Line<'static> {
    Line::from(Span::styled(
        text.to_string(),
        Style::new().fg(theme.dim),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_dot_is_green() {
        let theme = Theme::default();
        let (glyph, color) = dot(ServiceState::Running, &theme);
        assert_eq!(glyph, "●");
        assert_eq!(color, ratatui::style::Color::Indexed(114));
    }

    #[test]
    fn unhealthy_dot_is_red() {
        let theme = Theme::default();
        let (glyph, color) = dot(ServiceState::Unhealthy, &theme);
        assert_eq!(glyph, "✗");
        assert_eq!(color, ratatui::style::Color::Indexed(203));
    }

    #[test]
    fn absent_state_renders_dim_placeholder() {
        let theme = Theme::default();
        let line = status_line("proxy", None, &theme);
        assert!(line.spans[0].content.contains("○ proxy"));
    }
}

/// Dot glyph for a plain running/stopped boolean.
pub fn dot_state(running: bool, theme: &Theme) -> (&'static str, ratatui::style::Color) {
    if running {
        ("● run", theme.ok)
    } else {
        ("○ stop", theme.dim)
    }
}
