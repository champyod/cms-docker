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
                if app.current_route() == &app::Route::Actions {
                    // Menu keys are consumed by the Actions page; all other
                    // keys fall through to the global bindings below so page
                    // switching, going back (Esc), and quitting (q) still work.
                    match key.code {
                        KeyCode::Down | KeyCode::Char('j' | 'k') | KeyCode::Up => {
                            app.actions_menu.handle_key(key.code);
                            continue;
                        }
                        KeyCode::Enter => {
                            app.run_selected_action();
                            continue;
                        }
                        _ => {}
                    }
                }
                match key.code {
                    KeyCode::Char('q') => {
                        if app.current_route() == &app::Route::Actions {
                            app.quit();
                        } else if app.can_pop() {
                            app.pop_route();
                        } else {
                            app.quit();
                        }
                    }
                    KeyCode::Esc => {
                        if app.can_pop() {
                            app.pop_route();
                        } else {
                            app.quit();
                        }
                    }
                    KeyCode::Char('1') => app.push_route(app::Route::Dashboard),
                    KeyCode::Char('2') => app.push_route(app::Route::Actions),
                    KeyCode::Char('3') => app.push_route(app::Route::Customization),
                    KeyCode::Char('4') => app.push_route(app::Route::Security),
                    KeyCode::Char('5') => app.push_route(app::Route::Maintenance),
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
