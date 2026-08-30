use crossterm::event::KeyCode;
use ratatui::{
    layout::Rect,
    style::{Color, Style},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

const PAGE_SIZE: usize = 10;
const PAUSED_MARKER: &str = "-- PAUSED (press f to follow) --";
const EMPTY_PLACEHOLDER: &str = "(no output)";
const TITLE: &str = " Logs ";

pub struct LogViewer {
    lines: Vec<String>,
    scroll_offset: usize,
    follow_tail: bool,
}

impl LogViewer {
    pub fn new() -> Self {
        Self {
            lines: Vec::new(),
            scroll_offset: 0,
            follow_tail: true,
        }
    }
    pub fn append(&mut self, line: &str) {
        self.lines.push(line.to_string());
        if self.follow_tail {
            self.scroll_offset = 0;
        }
    }
    pub fn clear(&mut self) {
        self.lines.clear();
        self.scroll_offset = 0;
    }
    pub fn is_following(&self) -> bool {
        self.follow_tail
    }
    pub fn handle_key(&mut self, key: KeyCode) -> bool {
        match key {
            KeyCode::Up => {
                self.follow_tail = false;
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
                false
            }
            KeyCode::Down => {
                if self.follow_tail {
                    false
                } else {
                    let max: usize = self.lines.len().saturating_sub(1);
                    self.scroll_offset = (self.scroll_offset + 1).min(max);
                    false
                }
            }
            KeyCode::PageUp => {
                self.follow_tail = false;
                self.scroll_offset = self.scroll_offset.saturating_sub(PAGE_SIZE);
                false
            }
            KeyCode::PageDown => {
                if self.follow_tail {
                    false
                } else {
                    let max: usize = self.lines.len().saturating_sub(1);
                    self.scroll_offset = (self.scroll_offset + PAGE_SIZE).min(max);
                    false
                }
            }
            KeyCode::Char('f') | KeyCode::Char('F') => {
                self.follow_tail = !self.follow_tail;
                if self.follow_tail {
                    self.scroll_offset = 0;
                }
                false
            }
            KeyCode::Char('q') | KeyCode::Char('Q') | KeyCode::Esc => true,
            _ => false,
        }
    }
    pub fn render(&self, f: &mut Frame, area: Rect) {
        let visible: usize = (area.height as usize).saturating_sub(2);
        let content: String = self.build_content(visible);
        let paragraph: Paragraph<'_> = Paragraph::new(content)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(TITLE)
                    .style(Style::default().fg(Color::Cyan)),
            )
            .style(Style::default().fg(Color::White));
        f.render_widget(paragraph, area);
    }
    fn build_content(&self, visible: usize) -> String {
        if self.lines.is_empty() {
            return EMPTY_PLACEHOLDER.to_string();
        }
        if self.follow_tail {
            return self.tail_content(visible);
        }
        self.paused_content(visible)
    }
    fn tail_content(&self, visible: usize) -> String {
        if visible == 0 {
            return String::new();
        }
        let start: usize = self.lines.len().saturating_sub(visible);
        self.lines[start..].join("\n")
    }
    fn paused_content(&self, visible: usize) -> String {
        if visible == 0 {
            return PAUSED_MARKER.to_string();
        }
        let logs_visible: usize = visible.saturating_sub(1);
        if logs_visible == 0 {
            return PAUSED_MARKER.to_string();
        }
        let max_offset: usize = self.lines.len().saturating_sub(logs_visible);
        let offset: usize = self.scroll_offset.min(max_offset);
        let end: usize = (offset + logs_visible).min(self.lines.len());
        let window: String = self.lines[offset..end].join("\n");
        format!("{}\n{}", PAUSED_MARKER, window)
    }
}

impl Default for LogViewer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{LogViewer, EMPTY_PLACEHOLDER, PAGE_SIZE, PAUSED_MARKER};
    use crossterm::event::KeyCode;
    #[test]
    fn new_starts_empty_and_following() {
        let v: LogViewer = LogViewer::new();
        assert!(v.lines.is_empty());
        assert_eq!(v.scroll_offset, 0);
        assert!(v.is_following());
    }
    #[test]
    fn append_adds_lines() {
        let mut v: LogViewer = LogViewer::new();
        v.append("first");
        v.append("second");
        assert_eq!(v.lines.len(), 2);
        assert_eq!(v.lines[0], "first");
        assert_eq!(v.lines[1], "second");
        assert_eq!(v.scroll_offset, 0);
    }
    #[test]
    fn handle_key_down_no_lines_does_not_panic() {
        let mut v: LogViewer = LogViewer::new();
        assert!(!v.handle_key(KeyCode::Down));
        assert_eq!(v.scroll_offset, 0);
        assert!(!v.handle_key(KeyCode::Up));
        assert_eq!(v.scroll_offset, 0);
        assert!(!v.handle_key(KeyCode::PageDown));
        assert!(!v.handle_key(KeyCode::PageUp));
    }
    #[test]
    fn clear_empties() {
        let mut v: LogViewer = LogViewer::new();
        v.append("one");
        v.append("two");
        v.clear();
        assert!(v.lines.is_empty());
        assert_eq!(v.scroll_offset, 0);
    }
    #[test]
    fn f_toggles_follow() {
        let mut v: LogViewer = LogViewer::new();
        assert!(v.is_following());
        assert!(!v.handle_key(KeyCode::Char('f')));
        assert!(!v.is_following());
        assert!(!v.handle_key(KeyCode::Char('f')));
        assert!(v.is_following());
        assert!(!v.handle_key(KeyCode::Char('F')));
        assert!(!v.is_following());
    }
    #[test]
    fn q_returns_true_close_signal() {
        let mut v: LogViewer = LogViewer::new();
        assert!(v.handle_key(KeyCode::Char('q')));
        assert!(v.handle_key(KeyCode::Char('Q')));
        assert!(v.handle_key(KeyCode::Esc));
        assert!(!v.handle_key(KeyCode::Char('a')));
        assert!(!v.handle_key(KeyCode::Enter));
    }
    #[test]
    fn scrolling_clamps_to_bounds() {
        let mut v: LogViewer = LogViewer::new();
        for i in 0..30 {
            v.append(&format!("line {}", i));
        }
        v.handle_key(KeyCode::Up);
        for _ in 0..100 {
            v.handle_key(KeyCode::Down);
        }
        let max: usize = v.lines.len().saturating_sub(1);
        assert!(v.scroll_offset <= max);
        for _ in 0..20 {
            v.handle_key(KeyCode::PageDown);
        }
        assert!(v.scroll_offset <= max);
        let visible: usize = 10;
        let max_vis: usize = v.lines.len().saturating_sub(visible);
        assert!(v.scroll_offset <= max || max_vis <= max);
        let before: usize = v.scroll_offset;
        v.handle_key(KeyCode::PageUp);
        assert_eq!(v.scroll_offset, before.saturating_sub(PAGE_SIZE));
        assert!(PAUSED_MARKER.contains("PAUSED"));
        assert_eq!(EMPTY_PLACEHOLDER, "(no output)");
    }
}
