mod app;
mod data;
mod keys;
mod menu;
mod style;
mod ui;
mod wizards;

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    loop {
        let mut terminal = style::init_terminal()?;
        let mut app = app::App::new(style::Theme::default());
        let result = app.run(&mut terminal).await;
        style::restore_terminal()?;
        result?;
        let Some(cmd) = app.pending_cmd.take() else {
            return Ok(());
        };
        println!("running: ./cms {cmd}");
        let _ = tokio::process::Command::new("bash")
            .arg("cms")
            .arg(&cmd)
            .status()
            .await;
        println!("\n[done] press Enter to reopen the dashboard");
        let mut line = String::new();
        let _ = std::io::stdin().read_line(&mut line);
    }
}
