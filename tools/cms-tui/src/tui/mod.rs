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

/// The page a page-shortcut key jumps to, or `None` when the key is not one.
///
/// WHY a table rather than a chain of `match` arms inside the loop: the shortcuts are a
/// single mapping, and keeping them together is what makes the missing digit (there is
/// no `Route` for one) obvious at a glance.
const fn route_for_key(code: KeyCode) -> Option<app::Route> {
    match code {
        KeyCode::Char('1') => Some(app::Route::Dashboard),
        KeyCode::Char('2') => Some(app::Route::Stacks),
        KeyCode::Char('3') => Some(app::Route::Database),
        KeyCode::Char('4') => Some(app::Route::Worker),
        KeyCode::Char('5') => Some(app::Route::Ingress),
        KeyCode::Char('6') => Some(app::Route::Config),
        KeyCode::Char('7') => Some(app::Route::Backup),
        KeyCode::Char('8') => Some(app::Route::System),
        KeyCode::Char('9') => Some(app::Route::Bootstrap),
        KeyCode::Char('0' | 'l' | 'L') => Some(app::Route::Logs),
        _ => None,
    }
}

/// Leaves the current view, quitting outright when there is nothing to go back to.
///
/// WHY Esc falls back to quitting: on a page with no history there is nothing to go
/// back to, and a key that did nothing at all would read as a stuck TUI.
fn leave_current_view(app: &mut App) {
    if app.can_pop() {
        app.pop_route();
    } else {
        app.quit();
    }
}

/// Opens one of the two Ingress sub-pages, reporting whether the key was one of its keys.
fn open_ingress_subpage(app: &mut App, code: KeyCode) -> bool {
    match code {
        KeyCode::Char('e' | 'E') => app.push_route(app::Route::Exposure),
        KeyCode::Char('d' | 'D') => app.push_route(app::Route::Domain),
        _ => return false,
    }
    true
}

/// Applies the exposure chooser's verdict, turning a refusal into the toast text.
fn handle_exposure_key(app: &mut App, code: KeyCode) {
    match app.handle_exposure_key(code) {
        app::expose_keys::ExposureAction::Apply => {
            let message = match app.apply_exposure_choice() {
                Ok(text) => text,
                Err(reason) => format!("blocked: {reason}"),
            };
            app.set_toast(&message);
        }
        app::expose_keys::ExposureAction::Back => app.leave_exposure(),
        app::expose_keys::ExposureAction::Handled | app::expose_keys::ExposureAction::Ignored => {}
    }
}

/// Submits the domain form when it is armed, reporting refusals as a toast.
fn handle_domain_key(app: &mut App, code: KeyCode) {
    match app.handle_domain_key(code) {
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
}

/// Lets the page that owns the current route claim the key first.
///
/// WHY most specific first: the exposure chooser and the domain form both bind keys the
/// shared menu keys also claim, so a page that gets first refusal is the only way both
/// can mean what their own help line says.
fn handle_page_owned_key(app: &mut App, code: KeyCode) -> bool {
    match app.current_route() {
        app::Route::Logs => {
            if app.log_viewer.handle_key(code) {
                app.pop_route();
            }
            true
        }
        app::Route::Exposure => {
            handle_exposure_key(app, code);
            true
        }
        app::Route::Ingress => open_ingress_subpage(app, code),
        app::Route::Domain => {
            handle_domain_key(app, code);
            true
        }
        _ => false,
    }
}

/// The menu keys every page without a form of its own responds to.
fn handle_menu_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Down | KeyCode::Up | KeyCode::Char('j' | 'k') => {
            if let Some(menu) = app.active_menu() {
                menu.handle_key(code);
            }
        }
        KeyCode::Enter => app.run_selected_action(),
        _ => {}
    }
}

/// Routes one key press through the global, page-owned and menu bindings in that order.
fn handle_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Char('q') => {
            app.quit();
            return;
        }
        KeyCode::Esc => {
            leave_current_view(app);
            return;
        }
        _ => {}
    }
    if let Some(route) = route_for_key(code) {
        app.push_route(route);
        return;
    }
    if handle_page_owned_key(app, code) {
        return;
    }
    handle_menu_key(app, code);
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
                handle_key(app, key.code);
            }
        }
    }
    Ok(())
}
