pub mod app;
pub mod components;
pub mod menus;
pub mod pages;
pub mod stack_entries;

use app::App;
use components::template;
use ratatui::{
    backend::Backend,
    crossterm::{
        event::{self, Event, KeyCode},
        execute,
        terminal::{disable_raw_mode, LeaveAlternateScreen},
    },
    Terminal,
};
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

    let mut stdout = io::stdout();
    disable_raw_mode()?;
    execute!(stdout, LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        eprintln!("cms error: {err}");
    }

    Ok(())
}

/// Handles the keys that belong to a page which owns its own bindings.
///
/// Returns whether the page consumed the key. The domain form is one: its rows take
/// characters, its arming step takes `y`, and its submit key launches the run — none of
/// which the shared menu keys can express.
fn handle_page_owned_key(app: &mut App, key: KeyCode) -> bool {
    if *app.current_route() == app::Route::Domain {
        handle_domain_key(app, key);
        return true;
    }
    if *app.current_route() == app::Route::Ingress && matches!(key, KeyCode::Char('d' | 'D')) {
        app.push_route(app::Route::Domain);
        return true;
    }
    false
}

/// Dispatches one key to the domain form and acts on what it asked for.
fn handle_domain_key(app: &mut App, key: KeyCode) {
    use app::domain_keys::DomainKeyOutcome;
    match app.handle_domain_key(key) {
        DomainKeyOutcome::Submit => {
            if let Err(reason) = app.run_domain_form() {
                app.set_toast(&format!("Failed to run: {reason}"));
            }
        }
        DomainKeyOutcome::Back => app.pop_route(),
        DomainKeyOutcome::Arming
        | DomainKeyOutcome::Confirmed
        | DomainKeyOutcome::Cancelled
        | DomainKeyOutcome::Edited
        | DomainKeyOutcome::Ignored => {}
    }
}

fn run_app<B>(terminal: &mut Terminal<B>, app: &mut App) -> Result<(), Box<dyn Error>>
where
    B: Backend,
    B::Error: 'static,
{
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
                    KeyCode::Char('0') | KeyCode::Char('l' | 'L') => {
                        app.push_route(app::Route::Logs);
                        continue;
                    }
                    _ => {}
                }

                // Logs page owns its own scroll keys; avoid stealing them.
                if *app.current_route() == app::Route::Logs {
                    if app.log_viewer.handle_key(key.code) {
                        app.pop_route();
                    }
                    continue;
                }

                // Pages that own their own key meanings consume everything they recognise
                // before the shared menu keys, so a form row and a menu never fight over
                // one keystroke.
                if handle_page_owned_key(app, key.code) {
                    continue;
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
