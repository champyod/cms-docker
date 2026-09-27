use super::{ActionMenu, MenuItem};
use ratatui::crossterm::event::KeyCode;

fn sample_menu() -> ActionMenu {
    ActionMenu::new(vec![
        (
            "Deploy Core Stack".to_string(),
            "deploy core services".to_string(),
        ),
        ("Run Backup".to_string(), "backup database".to_string()),
        (
            "Restart Worker".to_string(),
            "restart worker fleet".to_string(),
        ),
    ])
}

#[test]
fn new_builds_items() {
    let menu: ActionMenu = sample_menu();
    assert_eq!(menu.len(), 3);
    assert!(!menu.is_empty());
    assert_eq!(menu.selected(), 0);
    assert_eq!(menu.selected_label(), "Deploy Core Stack");
}

#[test]
fn handle_key_enter_returns_index() {
    let mut menu: ActionMenu = sample_menu();
    let result: Option<usize> = menu.handle_key(KeyCode::Enter);
    assert_eq!(result, Some(0));
    menu.handle_key(KeyCode::Down);
    let result_second: Option<usize> = menu.handle_key(KeyCode::Enter);
    assert_eq!(result_second, Some(1));
}

#[test]
fn up_down_moves_and_clamps() {
    let mut menu: ActionMenu = sample_menu();
    assert_eq!(menu.selected(), 0);
    menu.handle_key(KeyCode::Up);
    assert_eq!(menu.selected(), 0);
    menu.handle_key(KeyCode::Down);
    assert_eq!(menu.selected(), 1);
    menu.handle_key(KeyCode::Down);
    assert_eq!(menu.selected(), 2);
    menu.handle_key(KeyCode::Down);
    assert_eq!(menu.selected(), 2);
    menu.handle_key(KeyCode::Up);
    assert_eq!(menu.selected(), 1);
    menu.handle_key(KeyCode::Up);
    assert_eq!(menu.selected(), 0);
    menu.handle_key(KeyCode::Up);
    assert_eq!(menu.selected(), 0);
}

#[test]
fn never_goes_out_of_bounds() {
    let mut menu: ActionMenu = sample_menu();
    for _ in 0..10 {
        menu.handle_key(KeyCode::Down);
    }
    assert!(menu.selected() < menu.len());
    for _ in 0..10 {
        menu.handle_key(KeyCode::Up);
    }
    assert!(menu.selected() < menu.len());
}

#[test]
fn j_k_vim_style_moves() {
    let mut menu: ActionMenu = sample_menu();
    menu.handle_key(KeyCode::Char('j'));
    assert_eq!(menu.selected(), 1);
    menu.handle_key(KeyCode::Char('j'));
    assert_eq!(menu.selected(), 2);
    menu.handle_key(KeyCode::Char('k'));
    assert_eq!(menu.selected(), 1);
    menu.handle_key(KeyCode::Char('k'));
    assert_eq!(menu.selected(), 0);
    menu.handle_key(KeyCode::Char('k'));
    assert_eq!(menu.selected(), 0);
    menu.handle_key(KeyCode::Char('j'));
    menu.handle_key(KeyCode::Char('j'));
    menu.handle_key(KeyCode::Char('j'));
    assert_eq!(menu.selected(), 2);
}

#[test]
fn selected_label_reflects_current_selection() {
    let mut menu: ActionMenu = sample_menu();
    assert_eq!(menu.selected_label(), "Deploy Core Stack");
    menu.handle_key(KeyCode::Down);
    assert_eq!(menu.selected_label(), "Run Backup");
    menu.handle_key(KeyCode::Down);
    assert_eq!(menu.selected_label(), "Restart Worker");
    menu.handle_key(KeyCode::Up);
    assert_eq!(menu.selected_label(), "Run Backup");
}

/// Guards the label/command distinction: the menu shows a label, but the
/// runner must spawn the command. Running the label yields exit 127.
#[test]
fn selected_command_is_the_command_not_the_label() {
    let mut menu: ActionMenu = sample_menu();
    assert_ne!(menu.selected_command(), menu.selected_label());
    assert_eq!(menu.selected_command(), sample_menu().selected_command());
    menu.handle_key(KeyCode::Down);
    assert_ne!(menu.selected_command(), menu.selected_label());
}

#[test]
fn empty_menu_behavior() {
    let mut menu: ActionMenu = ActionMenu::new(vec![]);
    assert_eq!(menu.len(), 0);
    assert!(menu.is_empty());
    assert_eq!(menu.selected_label(), "");
    assert_eq!(menu.selected_command(), "");
    let result: Option<usize> = menu.handle_key(KeyCode::Enter);
    assert_eq!(result, None);
    let result_down: Option<usize> = menu.handle_key(KeyCode::Down);
    assert_eq!(result_down, None);
    let result_up: Option<usize> = menu.handle_key(KeyCode::Up);
    assert_eq!(result_up, None);
    let result_j: Option<usize> = menu.handle_key(KeyCode::Char('j'));
    assert_eq!(result_j, None);
    assert_eq!(menu.selected(), 0);
}

#[test]
fn handle_key_other_keys_return_none() {
    let mut menu: ActionMenu = sample_menu();
    assert_eq!(menu.handle_key(KeyCode::Char('x')), None);
    assert_eq!(menu.handle_key(KeyCode::Esc), None);
    assert_eq!(menu.selected(), 0);
}

#[test]
fn with_meta_preserves_tty_and_sudo_flags() {
    let menu = ActionMenu::with_meta(vec![(
        "Edit config.toml".to_string(),
        "nano config.toml".to_string(),
        true,
        false,
        false,
    )]);
    let Some(item): Option<&MenuItem> = menu.get_item(0) else {
        panic!("with_meta keeps every row it was given");
    };
    assert!(item.requires_tty);
    assert!(!item.requires_sudo);
    assert!(!item.capture_output);
}

#[test]
fn new_defaults_to_non_tty() {
    let menu = ActionMenu::new(vec![("Label".to_string(), "cmd".to_string())]);
    let Some(item): Option<&MenuItem> = menu.get_item(0) else {
        panic!("new keeps every row it was given");
    };
    assert!(!item.requires_tty);
    assert!(!item.requires_sudo);
}

#[test]
fn get_item_past_the_last_row_is_none() {
    let menu: ActionMenu = sample_menu();
    assert!(menu.get_item(menu.len()).is_none());
}

#[test]
fn items_exposes_every_row_in_draw_order() {
    let menu: ActionMenu = sample_menu();
    let labels: Vec<&str> = menu
        .items()
        .iter()
        .map(|item| item.label.as_str())
        .collect();
    assert_eq!(
        labels,
        vec!["Deploy Core Stack", "Run Backup", "Restart Worker"]
    );
}
