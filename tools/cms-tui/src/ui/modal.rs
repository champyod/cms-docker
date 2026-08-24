//! Confirm modals and streamed log overlay.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Clear, Paragraph};

#[derive(Debug, Clone)]
pub struct Confirm {
    pub title: String,
    pub body: Vec<String>,
    pub kind: Kind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Deploy(u32),
    Stop(u32),
}

impl Confirm {
    pub fn deploy_preview(shard: u32) -> Self {
        Self {
            title: " DEPLOY PREVIEW ".into(),
            body: vec![
                format!("Deploy worker shard {shard}?"),
                String::new(),
                format!("docker compose -p cw{shard} up -d --no-build"),
                String::new(),
                "[y] confirm · [n/Esc] cancel".into(),
            ],
            kind: Kind::Deploy(shard),
        }
    }

    pub fn stop_confirm(shard: u32) -> Self {
        Self {
            title: " STOP CONFIRM ".into(),
            body: vec![
                format!("Stop worker shard {shard}?"),
                String::new(),
                "[y] confirm · [n/Esc] cancel".into(),
            ],
            kind: Kind::Stop(shard),
        }
    }

    pub fn render(&self, frame: &mut ratatui::Frame, theme: &crate::style::Theme) {
        let area = centered(frame.size(), 60, self.body.len() as u16 + 2);
        let block = widgets_panel(self.title.as_str(), theme);
        let text: Vec<Line> = self
            .body
            .iter()
            .map(|l| Line::from(l.clone()))
            .collect();
        frame.render_widget(Clear, area);
        frame.render_widget(Paragraph::new(text).block(block), area);
    }
}

fn widgets_panel(title: &str, theme: &crate::style::Theme) -> ratatui::widgets::Block<'static> {
    ratatui::widgets::Block::default()
        .title(title.to_string())
        .title_style(Style::new().fg(theme.accent).add_modifier(Modifier::BOLD))
        .borders(ratatui::widgets::Borders::ALL)
}

fn centered(area: Rect, w: u16, h: u16) -> Rect {
    let x = area.x + area.width.saturating_sub(w) / 2;
    let y = area.y + area.height.saturating_sub(h) / 2;
    Rect::new(x, y, w.min(area.width), h.min(area.height))
}

/// Shared line buffer fed by the background `docker logs -f` task.
#[derive(Clone, Default)]
pub struct LogBuffer {
    inner: Arc<(Mutex<VecDeque<String>>, AtomicBool)>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, line: String) {
        if let Ok(mut q) = self.inner.0.lock() {
            if q.len() >= 500 {
                q.pop_front();
            }
            q.push_back(line);
        }
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.inner
            .0
            .lock()
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn is_killed(&self) -> bool {
        self.inner.1.load(Ordering::Relaxed)
    }

    pub fn kill(&self) {
        self.inner.1.store(true, Ordering::Relaxed);
    }
}

/// Spawns `docker logs -f --tail N <container>` feeding the buffer.
/// The task exits when the kill flag flips or the child dies.
pub fn spawn_log_tail(buffer: LogBuffer, container: String) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut child = match tokio::process::Command::new("docker")
            .args(["logs", "-f", "--tail", "100", &container])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(c) => c,
            Err(_) => {
                buffer.push(format!("failed to spawn docker logs for {container}"));
                return;
            },
        };
        use tokio::io::{AsyncBufReadExt, BufReader};
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout).lines();
            loop {
                let line = match reader.next_line().await {
                    Ok(Some(l)) => l,
                    _ => break,
                };
                if buffer.is_killed() {
                    break;
                }
                buffer.push(line);
            }
        }
        let _ = child.kill().await;
    })
}

pub fn render_logs(
    frame: &mut ratatui::Frame,
    theme: &crate::style::Theme,
    title: &str,
    lines: &[String],
) {
    let area = frame.size();
    let inner_h = area.height.saturating_sub(4) as usize;
    let start = lines.len().saturating_sub(inner_h);
    let text: Vec<Line> = lines[start..]
        .iter()
        .map(|l| Line::from(Span::raw(l.clone())))
        .chain(std::iter::once(Line::from(Span::styled(
            " [q] close stream",
            Style::new().fg(theme.accent),
        ))))
        .collect();
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(text).block(widgets_panel(title, theme)),
        area,
    );
}

