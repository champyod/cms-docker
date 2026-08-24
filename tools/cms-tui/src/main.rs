mod app;
mod data;
mod keys;
mod style;
mod ui;

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    let mut terminal = style::init_terminal()?;
    let mut app = app::App::new(style::Theme::default());
    let result = app.run(&mut terminal).await;
    style::restore_terminal()?;
    result
}
