use super::route::{Route, WorkingPopup};
use crate::core::model::AppState;
use crate::tui::components::action_menu::ActionMenu;
use crate::tui::components::log_viewer::LogViewer;

pub struct App {
    route_stack: Vec<Route>,
    should_quit: bool,
    pub(crate) should_show_working_popup: bool,
    pub working_message: WorkingPopup,
    pub last_toast: Option<(String, u8)>,
    pub state: AppState,
    pub stacks_menu: ActionMenu,
    pub database_menu: ActionMenu,
    pub worker_menu: ActionMenu,
    pub ingress_menu: ActionMenu,
    pub config_menu: ActionMenu,
    pub backup_menu: ActionMenu,
    pub system_menu: ActionMenu,
    pub bootstrap_menu: ActionMenu,
    pub log_viewer: LogViewer,
}

impl App {
    #[must_use]
    pub fn new() -> Self {
        let state = AppState::new();
        Self {
            route_stack: vec![Route::Dashboard],
            should_quit: false,
            should_show_working_popup: false,
            working_message: WorkingPopup::Blinking,
            last_toast: None,
            state,
            stacks_menu: crate::tui::menus::stacks_menu(),
            database_menu: crate::tui::menus::database_menu(),
            worker_menu: crate::tui::menus::worker_menu(),
            ingress_menu: crate::tui::menus::ingress_menu(),
            config_menu: crate::tui::menus::config_menu(),
            backup_menu: crate::tui::menus::backup_menu(),
            system_menu: crate::tui::menus::system_menu(),
            bootstrap_menu: crate::tui::menus::bootstrap_menu(),
            log_viewer: LogViewer::new(),
        }
    }

    #[must_use]
    pub fn current_route(&self) -> &Route {
        self.route_stack.last().unwrap_or(&Route::Dashboard)
    }

    pub fn active_menu(&mut self) -> Option<&mut ActionMenu> {
        match self.current_route() {
            Route::Stacks => Some(&mut self.stacks_menu),
            Route::Database => Some(&mut self.database_menu),
            Route::Worker => Some(&mut self.worker_menu),
            Route::Ingress => Some(&mut self.ingress_menu),
            Route::Config => Some(&mut self.config_menu),
            Route::Backup => Some(&mut self.backup_menu),
            Route::System => Some(&mut self.system_menu),
            Route::Bootstrap => Some(&mut self.bootstrap_menu),
            Route::Logs | Route::Dashboard => None,
        }
    }

    #[must_use]
    pub const fn is_quitting(&self) -> bool {
        self.should_quit
    }

    #[must_use]
    pub const fn can_pop(&self) -> bool {
        self.route_stack.len() > 1
    }

    #[must_use]
    pub const fn stack_depth(&self) -> usize {
        self.route_stack.len()
    }

    #[must_use]
    pub fn route_stack(&self) -> &[Route] {
        &self.route_stack
    }

    #[must_use]
    pub const fn should_show_working_popup(&self) -> bool {
        self.should_show_working_popup
    }

    pub fn push_route(&mut self, route: Route) {
        if self.current_route() != &route {
            self.route_stack.push(route);
            self.refresh_for_route();
        }
    }

    pub fn pop_route(&mut self) {
        if self.can_pop() {
            self.route_stack.pop();
            self.refresh_for_route();
        }
    }

    pub fn reset_to_home(&mut self) {
        self.route_stack.clear();
        self.route_stack.push(Route::Dashboard);
        self.refresh_for_route();
    }

    fn refresh_for_route(&mut self) {
        match self.current_route() {
            Route::Stacks => {
                self.stacks_menu = crate::tui::menus::stacks_menu();
            }
            Route::Database => {
                self.database_menu = crate::tui::menus::database_menu();
            }
            Route::Worker => {
                self.worker_menu = crate::tui::menus::worker_menu();
            }
            Route::Ingress => {
                self.ingress_menu = crate::tui::menus::ingress_menu();
            }
            Route::Config => {
                self.config_menu = crate::tui::menus::config_menu();
            }
            Route::Backup => {
                self.backup_menu = crate::tui::menus::backup_menu();
            }
            Route::System => {
                self.system_menu = crate::tui::menus::system_menu();
            }
            Route::Bootstrap => {
                self.bootstrap_menu = crate::tui::menus::bootstrap_menu();
            }
            Route::Logs | Route::Dashboard => {}
        }
    }

    pub const fn quit(&mut self) {
        self.should_quit = true;
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
