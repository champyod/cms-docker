pub mod exec;
pub mod route;
pub mod state;
pub mod terminal;

pub use route::{Route, WorkingPopup};
pub use state::App;
pub use terminal::run;

#[cfg(test)]
mod tests {
    use super::{App, Route};

    fn app() -> App {
        App::new()
    }

    #[test]
    fn push_replaces_current_route() {
        let mut app = app();
        app.push_route(Route::System);
        assert_eq!(*app.current_route(), Route::System);
        assert_eq!(app.stack_depth(), 2);
    }

    #[test]
    fn push_ignores_duplicate_current_route() {
        let mut app = app();
        app.push_route(Route::System);
        app.push_route(Route::System);
        assert_eq!(app.stack_depth(), 2);
    }

    #[test]
    fn pop_returns_to_dashboard_but_never_empty() {
        let mut app = app();
        app.push_route(Route::Stacks);
        app.push_route(Route::Bootstrap);
        app.pop_route();
        assert_eq!(*app.current_route(), Route::Stacks);
        app.pop_route();
        assert_eq!(*app.current_route(), Route::Dashboard);
        app.pop_route();
        assert_eq!(app.stack_depth(), 1);
    }

    #[test]
    fn run_selected_action_empty_selection_is_noop() {
        let mut app = app();
        app.push_route(Route::Stacks);
        app.state.tasks.clear();
        // Refresh is not needed — menus built from catalog, but keep state empty
        app.run_selected_action();
        assert!(app.last_toast.is_some());
    }
}
