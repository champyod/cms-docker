pub mod app;
pub mod components;
pub mod menus;
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

                // The exposure chooser owns its own key meanings (two cursors plus
                // Enter-to-apply), so it is handled before the shared menu keys and
                // consumes everything it recognises.
                if *app.current_route() == app::Route::Exposure {
                    match app.handle_exposure_key(key.code) {
                        app::expose_keys::ExposureAction::Apply => {
                            let message = match app.apply_exposure_choice() {
                                Ok(text) => text,
                                Err(reason) => format!("blocked: {reason}"),
                            };
                            app.set_toast(&message);
                        }
                        app::expose_keys::ExposureAction::Back => app.leave_exposure(),
                        app::expose_keys::ExposureAction::Handled => {}
                        app::expose_keys::ExposureAction::Ignored => {}
                    }
                    continue;
                }

                // 'e' opens the exposure chooser from the Ingress page.
                if *app.current_route() == app::Route::Ingress
                    && matches!(key.code, KeyCode::Char('e' | 'E'))
                {
                    app.push_route(app::Route::Exposure);
                    continue;
                }

                // 'd' opens the domain setup form from the Ingress page.
                if *app.current_route() == app::Route::Ingress
                    && matches!(key.code, KeyCode::Char('d' | 'D'))
                {
                    app.push_route(app::Route::Domain);
                    continue;
                }

                // The domain form owns its rows, its arming step and its submit key, so
                // it consumes every key it recognises before the shared menu keys.
                if *app.current_route() == app::Route::Domain {
                    match app.handle_domain_key(key.code) {
                        pages::domain::DomainAction::Submit => {
                            if let Err(reason) = app.run_domain_setup() {
                                app.set_toast(&format!("Failed to run: {reason}"));
                            }
                        }
                        pages::domain::DomainAction::Back => app.leave_domain(),
                        pages::domain::DomainAction::Arming
                        | pages::domain::DomainAction::Confirmed
                        | pages::domain::DomainAction::Cancelled
                        | pages::domain::DomainAction::Edited
                        | pages::domain::DomainAction::Ignored => {}
                    }
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
