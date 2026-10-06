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
    /// The exposure chooser state, preserved across visits.
    ///
    /// WHY it lives on `App` rather than being rebuilt on entry: a rebuilt chooser
    /// would forget which UI the operator had selected every time they came back from
    /// running a certbot command, which on a five-UI list is the difference between
    /// adjusting one row and hunting for it again.
    pub exposure: crate::tui::pages::expose::ExposureView,
    /// The domain setup form, preserved across visits.
    ///
    /// WHY it lives on `App` and is not rebuilt on entry: the form is seeded from
    /// `config.toml` and `.env`, so rebuilding would discard every row the operator had
    /// already filled in, including the ones they came back to change.
    pub domain: crate::tui::pages::domain::DomainView,
}

impl App {
    #[must_use]
    pub fn new() -> Self {
        let state = AppState::new();
        // WHY the same helper the chooser uses rather than an inline comparison:
        // "the domain nginx owns :80/:443" has one definition, and a second copy here
        // is how the greying and the wiring drift apart. The observation is made here
        // because this is where the view is seeded — the rule itself stays pure.
        let domain_active = crate::core::expose::domain_stack_is_active(
            crate::tui::pages::expose::domain_proxy_running(),
        );
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
            exposure: crate::tui::pages::expose::ExposureView::new(domain_active, false, None),
            domain: crate::tui::pages::domain::DomainView::from_disk(&runner_repo_root()),
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
            // The exposure chooser has no menu: it is a two-cursor form, so the key
            // handler works on `exposure` directly rather than through an ActionMenu.
            Route::Exposure => None,
            // Same for the domain form: its rows and its arming step are handled
            // directly, so no ActionMenu is consulted for it.
            Route::Domain => None,
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
            Route::Logs | Route::Dashboard | Route::Exposure | Route::Domain => {}
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

/// The repo root the form seeds itself from, falling back to the working directory.
///
/// WHY a fallback rather than a failure: the TUI has to open on a box that has not been
/// set up yet, and an empty form is exactly right there.
fn runner_repo_root() -> std::path::PathBuf {
    crate::core::runner::Runner::new()
        .map(|runner| runner.repo_root().to_path_buf())
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}
