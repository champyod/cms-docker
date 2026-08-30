pub mod actions;
pub mod customization;
pub mod dashboard;
pub mod maintenance;
pub mod security;

use crate::core::model::Environment;
use crate::tui::app::{App, Route};
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

pub fn render_content(f: &mut Frame, area: Rect, app: &App) {
    match app.current_route() {
        Route::Dashboard => dashboard::render(f, area, app),
        Route::Actions => actions::render(f, area, app),
        Route::Customization => customization::render(f, area, app),
        Route::Security => security::render(f, area, app),
        Route::Maintenance => maintenance::render(f, area, app),
    }
}

pub const ALL_ENVIRONMENTS: [Environment; 6] = [
    Environment::Core,
    Environment::Contest,
    Environment::Admin,
    Environment::Worker,
    Environment::Infra,
    Environment::Monitoring,
];

pub fn render_env_list(f: &mut Frame, area: Rect, title: &str) {
    let rows: Vec<String> = ALL_ENVIRONMENTS
        .iter()
        .map(|env| format!("  • {}", env))
        .collect();
    let body = Paragraph::new(rows.join("\n"))
        .style(
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(format!(" {} ", title)),
        );
    f.render_widget(body, area);
}
