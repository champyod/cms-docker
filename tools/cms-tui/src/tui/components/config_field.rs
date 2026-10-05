//! One editable row: its label, its text, and the cursor within it.
//!
//! WHY the row is its own module: the form around it is focus, navigation and rendering,
//! while a row is byte-index bookkeeping over a UTF-8 string. The cursor arithmetic is the
//! part that has to be right about multi-byte characters, and it is unreadable beside the
//! block layout that never touches it.

/// A single form row: the label the form is read back by, the text in it, and the cursor.
///
/// WHY the fields are visible to the form rather than kept private: the form owns focus and
/// paints, and a row that hid its own value and cursor could not be rendered or tested
/// through the form that holds it.
pub struct TextField {
    pub(super) label: String,
    pub(super) value: String,
    pub(super) cursor: usize,
    pub(super) focused: bool,
}

impl TextField {
    pub(super) const fn new(label: String, value: String, focused: bool) -> Self {
        let cursor = value.len();
        Self {
            label,
            value,
            cursor,
            focused,
        }
    }

    pub(super) fn insert_char(&mut self, ch: char) {
        let clamped = self.cursor.min(self.value.len());
        self.value.insert(clamped, ch);
        self.cursor = clamped + ch.len_utf8();
        // Clamp to value length (handles multi-byte but keeps byte index valid)
        if self.cursor > self.value.len() {
            self.cursor = self.value.len();
        }
    }

    pub(super) fn delete_before_cursor(&mut self) {
        if self.cursor == 0 || self.value.is_empty() {
            return;
        }
        let clamped = self.cursor.min(self.value.len());
        if clamped == 0 {
            return;
        }
        // Find previous char boundary
        let prev = self.value[..clamped]
            .char_indices()
            .last()
            .map_or(0, |(idx, _)| idx);
        self.value.drain(prev..clamped);
        self.cursor = prev;
    }

    pub(super) fn move_cursor_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let clamped = self.cursor.min(self.value.len());
        if clamped == 0 {
            self.cursor = 0;
            return;
        }
        let prev = self.value[..clamped]
            .char_indices()
            .last()
            .map_or(0, |(idx, _)| idx);
        self.cursor = prev;
    }

    pub(super) fn move_cursor_right(&mut self) {
        if self.cursor >= self.value.len() {
            self.cursor = self.value.len();
            return;
        }
        let clamped = self.cursor.min(self.value.len());
        if clamped >= self.value.len() {
            return;
        }
        let ch_len = self.value[clamped..]
            .chars()
            .next()
            .map_or(1, char::len_utf8);
        self.cursor = (clamped + ch_len).min(self.value.len());
    }
}
