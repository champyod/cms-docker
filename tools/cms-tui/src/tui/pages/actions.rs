use crate::tui::app::App;
use crate::tui::components::action_menu::ActionMenu;
use ratatui::layout::Rect;
use ratatui::Frame;

pub fn render(f: &mut Frame, area: Rect, app: &App) {
    let items: Vec<(String, String)> = app
        .state
        .tasks
        .iter()
        .map(|task| {
            (
                task.name.clone(),
                format!("{:?} · {}", task.category, task.command),
            )
        })
        .collect();

    let title = format!(" Actions & Deployment — {} tasks ", items.len());
    let menu = ActionMenu::new(items);
    menu.render(f, area, &title);
}
