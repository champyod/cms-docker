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

pub async fn run() -> Result<(), Box<dyn Error>> {
    let mut terminal = app::run()?;
    let mut app = App::new();

    let res = run_app(&mut terminal, &mut app).await;

    // Restore terminal
    let mut stdout = io::stdout();
    crossterm::terminal::disable_raw_mode()?;
    execute!(stdout, crossterm::terminal::LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        eprintln!("cms-tui error: {:?}", err)
    }

    Ok(())
}

async fn run_app<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> io::Result<()> {
    while !app.is_quitting() {
        terminal.draw(|f| {
            template::render(f, app);
        })?;

        if event::poll(std::time::Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => {
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
                    // Trigger a test TTY drop command
                    KeyCode::Char('t') => {
                        let _ = app.run_command_in_tty("echo 'This is a simulated docker-up output' && echo 'Container foo started'");
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
