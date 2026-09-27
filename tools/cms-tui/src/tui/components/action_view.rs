use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use super::action_menu::{ActionMenu, MenuItem};

const EMPTY_MENU_TEXT: &str = "(no actions)";
const SELECTED_MARKER: &str = ">";
const UNSELECTED_MARKER: &str = " ";
const DESCRIPTION_INDENT: &str = "  ";

/// Draws the menu into `area`.
///
/// WHY: the widget code sits apart from the menu state so the event loop and
/// key handling stay free of ratatui, and an empty menu paints a placeholder
/// rather than indexing past the end of the row list.
pub fn render(menu: &ActionMenu, f: &mut Frame, area: Rect, title: &str) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(title.to_string());
    let Some(lines) = menu_lines(menu) else {
        let placeholder = Paragraph::new(EMPTY_MENU_TEXT)
            .style(Style::default().add_modifier(Modifier::DIM))
            .block(block);
        f.render_widget(placeholder, area);
        return;
    };
    f.render_widget(Paragraph::new(lines).block(block), area);
}

/// The label and command of every row, or `None` when there is no row to draw.
fn menu_lines(menu: &ActionMenu) -> Option<Vec<Line<'_>>> {
    if menu.items().is_empty() {
        return None;
    }
    Some(
        menu.items()
            .iter()
            .enumerate()
            .flat_map(|(index, item)| item_lines(item, index == menu.selected()))
            .collect(),
    )
}

fn item_lines(item: &MenuItem, is_selected: bool) -> [Line<'_>; 2] {
    [label_line(item, is_selected), description_line(item)]
}

fn label_line(item: &MenuItem, is_selected: bool) -> Line<'_> {
    let marker = if is_selected {
        SELECTED_MARKER
    } else {
        UNSELECTED_MARKER
    };
    let style = if is_selected {
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    };
    Line::from(Span::styled(format!("{marker} {}", item.label), style))
}

fn description_line(item: &MenuItem) -> Line<'_> {
    let style = Style::default()
        .fg(Color::DarkGray)
        .add_modifier(Modifier::DIM);
    Line::from(Span::styled(
        format!("{DESCRIPTION_INDENT}{}", item.description),
        style,
    ))
}

#[cfg(test)]
mod tests {
    use super::{render, ActionMenu};
    use ratatui::{backend::TestBackend, crossterm::event::KeyCode, layout::Rect, Terminal};

    const SCREEN_WIDTH: u16 = 40;
    const SCREEN_HEIGHT: u16 = 10;

    fn two_rows() -> ActionMenu {
        ActionMenu::new(vec![
            ("Deploy Core".to_string(), "make core".to_string()),
            ("Run Backup".to_string(), "make backup".to_string()),
        ])
    }

    fn draw(menu: &ActionMenu) -> String {
        let backend = TestBackend::new(SCREEN_WIDTH, SCREEN_HEIGHT);
        let mut terminal = Terminal::new(backend).expect("test terminal");
        let area = Rect::new(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        terminal
            .draw(|f| render(menu, f, area, "Actions"))
            .expect("draw the menu");
        terminal.backend().to_string()
    }

    #[test]
    fn empty_menu_paints_the_placeholder() {
        let screen = draw(&ActionMenu::new(vec![]));
        assert!(screen.contains("(no actions)"), "{screen}");
    }

    #[test]
    fn draws_the_label_and_the_command_of_every_row() {
        let screen = draw(&two_rows());
        assert!(screen.contains("Deploy Core"), "{screen}");
        assert!(screen.contains("make core"), "{screen}");
        assert!(screen.contains("Run Backup"), "{screen}");
        assert!(screen.contains("make backup"), "{screen}");
    }

    #[test]
    fn marks_only_the_selected_row() {
        let mut menu = two_rows();
        let first = draw(&menu);
        assert!(first.contains("> Deploy Core"), "{first}");
        menu.handle_key(KeyCode::Down);
        let second = draw(&menu);
        assert!(second.contains("> Run Backup"), "{second}");
        assert!(!second.contains("> Deploy Core"), "{second}");
    }
}
