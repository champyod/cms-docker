//! The alphabet the `CODENAME` domain allows, and the shapes it refuses.
//!
//! Every value here is one the domain's CHECK (`src/cms/db/types.py:51-66`)
//! settles: letters, digits, `_` and `-`, and anything else refused. The
//! refusals matter more than the acceptances, because a rule that admitted a
//! character the database refuses would let a login name reach a query that can
//! never store it. Nothing opens a connection.

use cms_db::{Codename, CodenameError};

#[test]
fn every_alphabet_character_the_domain_allows_is_accepted() {
    for value in ["Alice", "alice", "A0_-z", "contestant-01", "_", "-", "9"] {
        let parsed = Codename::parse(value).expect("the domain allows this value");
        assert_eq!(parsed.as_str(), value);
        assert_eq!(parsed.to_string(), value);
    }
}

#[test]
fn case_is_preserved_so_two_distinct_users_stay_distinct() {
    let upper = Codename::parse("Alice").expect("allowed");
    let lower = Codename::parse("alice").expect("allowed");

    assert_ne!(upper, lower);
    assert_eq!(upper.as_str(), "Alice");
    assert_eq!(lower.as_str(), "alice");
}

#[test]
fn a_name_outside_the_alphabet_is_refused_not_transliterated() {
    for (value, character) in [
        ("Zoë", 'ë'),
        ("zoé", 'é'),
        ("alice smith", ' '),
        ("alice.", '.'),
        ("alice@example", '@'),
        ("аlice", 'а'),
        ("alice\n", '\n'),
    ] {
        assert_eq!(
            Codename::parse(value),
            Err(CodenameError::ForbiddenCharacter { character }),
            "{value:?} must be refused, not normalised"
        );
    }
}

#[test]
fn an_empty_name_is_refused() {
    assert_eq!(Codename::parse(""), Err(CodenameError::Empty));
}

#[test]
fn the_first_forbidden_character_is_the_one_named() {
    assert_eq!(
        Codename::parse("ok!bad?"),
        Err(CodenameError::ForbiddenCharacter { character: '!' })
    );
}
