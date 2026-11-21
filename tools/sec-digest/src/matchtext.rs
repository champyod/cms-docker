//! Word matching with the boundaries Python gets from lookarounds.
//!
//! The `regex` crate has no lookbehind/lookahead, so the patterns here are plain
//! alternations and the boundary rules are applied to the surrounding characters
//! afterwards. Both rules are ported verbatim from the Python tool:
//! a token must not follow `[\w.-]` and must not be followed by `[\w-]`.

use regex::Regex;

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `(?<![\w.-])token(?![\w-])` applied to one match found at `start..end`.
fn bounded(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    let before_ok = before.is_none_or(|c| !is_word(c) && c != '.' && c != '-');
    let after_ok = after.is_none_or(|c| !is_word(c) && c != '-');
    before_ok && after_ok
}

/// Every bounded occurrence of the pattern, in text order.
pub fn bounded_matches(text: &str, re: &Regex) -> Vec<String> {
    re.find_iter(text)
        .filter(|m| bounded(text, m.start(), m.end()))
        .map(|m| m.as_str().to_string())
        .collect()
}

pub fn has_bounded_match(text: &str, re: &Regex) -> bool {
    re.find_iter(text).any(|m| bounded(text, m.start(), m.end()))
}

/// Build an alternation, longest token first so a prefix never shadows its longer form.
pub fn alternation(tokens: &[&str]) -> Regex {
    let mut sorted: Vec<&str> = tokens.to_vec();
    sorted.sort_by_key(|t| std::cmp::Reverse(t.len()));
    let pattern = sorted
        .iter()
        .map(|t| regex::escape(t))
        .collect::<Vec<_>>()
        .join("|");
    Regex::new(&pattern).expect("static alternation of literal tokens cannot fail")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundaries_follow_the_python_rules() {
        let re = alternation(&["linux", "next", "libssl"]);
        // Callers lowercase first, exactly as the Python collector did.
        assert_eq!(bounded_matches("linux kernel advisory", &re), vec!["linux"]);
        assert!(bounded_matches("linux_kernel", &re).is_empty());
        assert!(bounded_matches("xlinux", &re).is_empty());
        assert!(bounded_matches("libssl3", &re).is_empty());
        assert!(has_bounded_match("next.js package", &re));
    }
}
