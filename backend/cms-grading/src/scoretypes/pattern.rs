//! Matching a subtask's pattern against a codename, from the codename's first character.
//!
//! A dataset names the testcases of a subtask either by counting them or by a pattern, and
//! the pattern is what the reference hands to a regular-expression engine. This crate holds
//! no engine and a score type must not gain one, so what the reference's own loaders and
//! tasks actually write is read here: literals, `.`, `*`, `+`, `?`, `[a-z]` and `|`. A
//! pattern reaching past that is refused rather than mis-grouped, because a subtask that
//! silently selected different testcases would publish a different score.
//!
//! Matching is a prefix match, as `re.match` is: the pattern does not have to reach the end
//! of the codename, which is what `1_*` means to the task files that write it. A leading
//! `^` says the same thing a prefix match already does, so it is read and ignored.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

/// Whether a pattern matches a codename from its first character, as `re.match` does.
///
/// `None` means the pattern uses a construct this crate does not read.
pub(crate) fn matches(pattern: &str, codename: &str) -> Option<bool> {
    let text: Vec<char> = codename.chars().collect();
    for alternative in alternatives(pattern) {
        let alternative = alternative.strip_prefix('^').unwrap_or(&alternative);
        let atoms = atoms(alternative)?;
        if matches_prefix(&atoms, &text) {
            return Some(true);
        }
    }
    Some(false)
}

/// The alternatives of a pattern, split on `|` where it is not escaped.
fn alternatives(pattern: &str) -> Vec<String> {
    let mut alternatives = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    for character in pattern.chars() {
        if escaped {
            current.push('\\');
            current.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '|' {
            alternatives.push(std::mem::take(&mut current));
        } else {
            current.push(character);
        }
    }
    if escaped {
        current.push('\\');
    }
    alternatives.push(current);
    alternatives
}

/// One matchable position of a pattern, and how many times it repeats.
struct Atom {
    class: Class,
    repetition: Repetition,
}

/// What one position of a pattern accepts.
enum Class {
    Literal(char),
    Any,
    Set {
        negated: bool,
        ranges: Vec<(char, char)>,
    },
}

/// How many times the position before the quantifier repeats.
enum Repetition {
    Once,
    ZeroOrMore,
    OneOrMore,
    Optional,
}

/// The positions of one alternative, or `None` for a construct this crate does not read.
fn atoms(pattern: &str) -> Option<Vec<Atom>> {
    let mut characters = pattern.chars().peekable();
    let mut atoms = Vec::new();
    while let Some(character) = characters.next() {
        let class = match character {
            '\\' => Class::Literal(characters.next()?),
            '.' => Class::Any,
            '[' => character_class(&mut characters)?,
            '(' | ')' | '{' | '}' | '$' => return None,
            _ => Class::Literal(character),
        };
        let repetition = match characters.peek() {
            Some('*') => {
                characters.next();
                Repetition::ZeroOrMore
            }
            Some('+') => {
                characters.next();
                Repetition::OneOrMore
            }
            Some('?') => {
                characters.next();
                Repetition::Optional
            }
            _ => Repetition::Once,
        };
        atoms.push(Atom { class, repetition });
    }
    Some(atoms)
}

/// A bracketed class, from the opening bracket to its closing one.
fn character_class(characters: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Option<Class> {
    let negated = characters.peek() == Some(&'^');
    if negated {
        characters.next();
    }
    let mut members: Vec<(char, bool)> = Vec::new();
    let mut closed = false;
    while let Some(character) = characters.next() {
        if character == ']' && !members.is_empty() {
            closed = true;
            break;
        }
        let member = if character == '\\' {
            (characters.next()?, true)
        } else {
            (character, false)
        };
        members.push(member);
    }
    if !closed {
        return None;
    }
    Some(Class::Set {
        negated,
        ranges: ranges_of(&members),
    })
}

/// The class's members, with `a-z` read as a range and anything else as itself.
fn ranges_of(members: &[(char, bool)]) -> Vec<(char, char)> {
    let mut ranges = Vec::new();
    let mut position = 0;
    while position < members.len() {
        let (character, escaped) = members[position];
        match members.get(position + 2) {
            Some(&(end, _)) if !escaped && members[position + 1] == ('-', false) => {
                ranges.push((character, end));
                position += 3;
            }
            _ => {
                ranges.push((character, character));
                position += 1;
            }
        }
    }
    ranges
}

/// Whether the pattern's positions consume a prefix of the codename.
fn matches_prefix(atoms: &[Atom], text: &[char]) -> bool {
    let Some((atom, rest)) = atoms.split_first() else {
        // The pattern is spent, and a prefix is all it had to match.
        return true;
    };
    let accepts = text.first().is_some_and(|c| atom.class.accepts(*c));
    match atom.repetition {
        Repetition::Once => accepts && matches_prefix(rest, &text[1..]),
        Repetition::Optional => {
            matches_prefix(rest, text) || (accepts && matches_prefix(rest, &text[1..]))
        }
        Repetition::ZeroOrMore => repeats(atom, 0, rest, text),
        Repetition::OneOrMore => repeats(atom, 1, rest, text),
    }
}

/// Whether the positions after a quantified one match, trying every count it could take.
fn repeats(atom: &Atom, least: usize, rest: &[Atom], text: &[char]) -> bool {
    let mut consumed = 0;
    while text
        .get(consumed)
        .is_some_and(|character| atom.class.accepts(*character))
    {
        consumed += 1;
    }
    if consumed < least {
        return false;
    }
    (least..=consumed)
        .rev()
        .any(|count| matches_prefix(rest, &text[count..]))
}

impl Class {
    /// Whether this position accepts one character.
    fn accepts(&self, character: char) -> bool {
        match self {
            Self::Literal(expected) => *expected == character,
            Self::Any => true,
            Self::Set { negated, ranges } => {
                let inside = ranges
                    .iter()
                    .any(|(low, high)| (*low..=*high).contains(&character));
                inside != *negated
            }
        }
    }
}
