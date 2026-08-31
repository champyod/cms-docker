pub mod app;
pub mod components;
pub mod pages;

use app::App;
use components::template;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
};
use ratatui::Terminal;
use std::error::Error;
use std::io;

/// Runs the TUI event loop.
///
/// # Errors
///
/// Returns `Err` if terminal initialization fails.
pub fn run() -> Result<(), Box<dyn Error>> {
    let mut terminal = app::run()?;
    let mut app = App::new();

    let res = run_app(&mut terminal, &mut app);

    // Restore terminal
    let mut stdout = io::stdout();
    crossterm::terminal::disable_raw_mode()?;
    execute!(stdout, crossterm::terminal::LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        eprintln!("cms-tui error: {err:?}");
    }

    Ok(())
}

fn run_app<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> io::Result<()> {
    while !app.is_quitting() {
        terminal.draw(|f| {
            template::render(f, app);
        })?;

        if event::poll(std::time::Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                // Global keys that work on ANY page
                match key.code {
                    KeyCode::Char('q') => {
                        app.quit();
                        continue;
                    }
                    KeyCode::Esc => {
                        if app.can_pop() {
                            app.pop_route();
                        } else {
                            app.quit();
                        }
                        continue;
                    }
                    KeyCode::Char('1') => {
                        app.push_route(app::Route::Dashboard);
                        continue;
                    }
                    KeyCode::Char('2') => {
                        app.push_route(app::Route::Stacks);
                        continue;
                    }
                    KeyCode::Char('3') => {
                        app.push_route(app::Route::Database);
                        continue;
                    }
                    KeyCode::Char('4') => {
                        app.push_route(app::Route::Worker);
                        continue;
                    }
                    KeyCode::Char('5') => {
                        app.push_route(app::Route::Ingress);
                        continue;
                    }
                    KeyCode::Char('6') => {
                        app.push_route(app::Route::Config);
                        continue;
                    }
                    KeyCode::Char('7') => {
                        app.push_route(app::Route::Backup);
                        continue;
                    }
                    KeyCode::Char('8') => {
                        app.push_route(app::Route::System);
                        continue;
                    }
                    KeyCode::Char('9') => {
                        app.push_route(app::Route::Bootstrap);
                        continue;
                    }
                    _ => {}
                }

                // Page-specific keys (arrows, Enter) — only on non-Dashboard pages
                match key.code {
                    KeyCode::Down | KeyCode::Up | KeyCode::Char('j' | 'k') => {
                        if let Some(menu) = app.active_menu() {
                            menu.handle_key(key.code);
                        }
                    }
                    KeyCode::Enter => app.run_selected_action(),
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
