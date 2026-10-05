//! Editing cursor shared by every [`ConfigForm`] field kind.
//!
//! WHY a dedicated type rather than three copies of the index arithmetic: byte indices
//! into a UTF-8 string are only meaningful on a char boundary, and getting that wrong
//! on the TUI's Left/Backspace path panics inside the event loop, which takes the whole
//! app down instead of dropping one keystroke. One implementation, three field kinds.

/// A byte cursor into an owned string, always on a char boundary.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EditCursor(usize);

impl EditCursor {
    /// A cursor at a byte offset the caller has already validated as a boundary.
    #[must_use]
    pub const fn at(offset: usize) -> Self {
        Self(offset)
    }
    /// The position the new field's cursor starts at: one past the last character.
    #[must_use]
    pub const fn at_end(value: &str) -> Self {
        Self(value.len())
    }

    /// A cursor that cannot index past the end of `value`, even if `value` shrank.
    #[must_use]
    pub fn clamped(self, value: &str) -> Self {
        let mut cursor = self.0.min(value.len());
        while !value.is_char_boundary(cursor) {
            cursor = cursor.saturating_sub(1);
        }
        Self(cursor)
    }

    /// The raw byte offset, valid only for `value` it was clamped against.
    #[must_use]
    pub const fn offset(self) -> usize {
        self.0
    }

    /// Moves one character left, stopping at the start.
    pub fn back(&mut self, value: &str) {
        let current = self.clamped(value).0;
        if current == 0 {
            return;
        }
        self.0 = previous_boundary(value, current);
    }

    /// Moves one character right, stopping at the end.
    pub fn forward(&mut self, value: &str) {
        let current = self.clamped(value).0;
        self.0 = next_boundary(value, current).min(value.len());
    }
}

/// The byte index of the character before `at`, or 0 at the start of `value`.
fn previous_boundary(value: &str, at: usize) -> usize {
    value[..at]
        .char_indices()
        .next_back()
        .map_or(0, |(index, _)| index)
}

/// The byte index just past the character at `at`, or `at` at the end of `value`.
fn next_boundary(value: &str, at: usize) -> usize {
    value[at..]
        .chars()
        .next()
        .map_or(at, |ch| at + ch.len_utf8())
}

/// What a keystroke was allowed to change.
///
/// WHY a fallible outcome rather than a rejected insert: a keystroke the field refuses
/// has to stay visible somewhere, or the operator types a letter into an integer field,
/// sees no change, and concludes the form is frozen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyOutcome {
    /// The field did not change; the keystroke belonged to form navigation.
    Ignored,
    /// The field changed.
    Edited,
    /// The keystroke is wrong for this kind of field and was refused.
    Refused(&'static str),
}

impl KeyOutcome {
    /// Whether the keystroke changed the field.
    ///
    /// Navigation counts as a change: the focus moved, which is a visible edit.
    #[must_use]
    pub const fn is_edited(self) -> bool {
        matches!(self, Self::Edited)
    }
}

#[cfg(test)]
mod tests {
    use super::{EditCursor, KeyOutcome};

    #[test]
    fn a_new_cursor_sits_past_the_last_character() {
        assert_eq!(EditCursor::at_end("abc").offset(), 3);
        assert_eq!(EditCursor::at_end("").offset(), 0);
    }

    #[test]
    fn clamping_survives_a_value_that_shrank_underneath_it() {
        assert_eq!(EditCursor::at(9).clamped("abc").offset(), 3);
        assert_eq!(EditCursor::at(9).clamped("").offset(), 0);
    }

    #[test]
    fn clamping_lands_on_a_char_boundary_after_a_multibyte_edit() {
        // "é" is two bytes, so offsets 1 sits inside it and must step back to 0.
        assert_eq!(EditCursor::at(1).clamped("é!").offset(), 0);
        assert_eq!(EditCursor::at(2).clamped("é!").offset(), 2);
        assert_eq!(EditCursor::at(3).clamped("é!").offset(), 3);
    }

    #[test]
    fn back_and_forward_walk_one_character_at_a_time() {
        let mut cursor = EditCursor::at_end("ab");
        cursor.back("ab");
        assert_eq!(cursor.offset(), 1);
        cursor.back("ab");
        assert_eq!(cursor.offset(), 0);
        cursor.forward("ab");
        assert_eq!(cursor.offset(), 1);
        cursor.forward("ab");
        assert_eq!(cursor.offset(), 2);
    }

    #[test]
    fn back_and_forward_stop_at_the_edges() {
        let mut cursor = EditCursor::at_end("");
        cursor.back("");
        assert_eq!(cursor.offset(), 0);
        cursor.forward("");
        assert_eq!(cursor.offset(), 0);

        let mut at_start = EditCursor::at(0);
        at_start.back("abc");
        assert_eq!(at_start.offset(), 0);
        at_start.forward("abc");
        assert_eq!(at_start.offset(), 1);
    }

    #[test]
    fn walking_a_multibyte_string_never_splits_a_character() {
        // "héllo" is 6 bytes; "é" occupies bytes 1..3.
        let mut cursor = EditCursor::at_end("héllo");
        cursor.back("héllo");
        cursor.back("héllo");
        assert_eq!(
            cursor.offset(),
            4,
            "the cursor sits just before the second byte of é"
        );
        assert!("héllo".is_char_boundary(cursor.offset()));
    }

    #[test]
    fn outcomes_are_distinguishable() {
        assert_ne!(KeyOutcome::Edited, KeyOutcome::Ignored);
        assert_eq!(
            KeyOutcome::Refused("not a digit"),
            KeyOutcome::Refused("not a digit")
        );
    }
}
