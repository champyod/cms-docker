//! Version comparison without pulling a dependency.
//!
//! Handles semver, deb/alpine versions and GHSA ranges (`>= 1.0.0, < 1.2.3`).
//! Comparison is numeric-first then textual, and is only ever used to answer
//! "is our pinned version inside the published vulnerable range".

use std::cmp::Ordering;

use regex::Regex;
use std::sync::LazyLock;

static OP_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(>=|<=|>|<|=|==)\s*").expect("static operator prefix"));
static NUMERIC_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d+)(.*)$").expect("static numeric prefix"));
static CLAUSE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(>=|<=|>|<|=|==)\s*(\S+)$").expect("static range clause"));

/// One version component: numeric parts sort before textual ones.
#[derive(Debug, PartialEq, Eq)]
enum Part {
    Num(u64, String),
    Text(String),
}

fn parts(version: &str) -> Vec<Part> {
    let stripped = version.trim().trim_start_matches(['v', 'V']);
    let without_op = OP_PREFIX.replace(stripped, "");
    let mut out = Vec::new();
    for token in without_op.split(['.', '-', '_', '+', '~', ':']) {
        if token.is_empty() {
            continue;
        }
        if let Ok(n) = token.parse::<u64>() {
            out.push(Part::Num(n, String::new()));
        } else if let Some(caps) = NUMERIC_PREFIX.captures(token) {
            let n = caps[1].parse::<u64>().unwrap_or(0);
            out.push(Part::Num(n, caps[2].to_string()));
        } else {
            out.push(Part::Text(token.to_lowercase()));
        }
    }
    out
}

fn cmp_part(a: &Part, b: &Part) -> Ordering {
    match (a, b) {
        (Part::Num(x, xs), Part::Num(y, ys)) => x.cmp(y).then_with(|| xs.cmp(ys)),
        (Part::Num(..), Part::Text(_)) => Ordering::Less,
        (Part::Text(_), Part::Num(..)) => Ordering::Greater,
        (Part::Text(x), Part::Text(y)) => x.cmp(y),
    }
}

pub fn cmp(a: &str, b: &str) -> Ordering {
    let (pa, pb) = (parts(a), parts(b));
    for (x, y) in pa.iter().zip(pb.iter()) {
        let ord = cmp_part(x, y);
        if ord != Ordering::Equal {
            return ord;
        }
    }
    if pa.len() == pb.len() {
        return Ordering::Equal;
    }
    // A shorter version is lower only if the longer one adds a non-zero part.
    let (longer, sign) = if pa.len() > pb.len() {
        (&pa, Ordering::Greater)
    } else {
        (&pb, Ordering::Less)
    };
    for part in &longer[pa.len().min(pb.len())..] {
        let zero = matches!(part, Part::Num(0, s) if s.is_empty());
        if !zero {
            return sign;
        }
    }
    Ordering::Equal
}

/// True when `version` satisfies a GHSA-style range spec.
pub fn in_range(version: &str, spec: &str) -> bool {
    if spec.is_empty() || version.is_empty() {
        return false;
    }
    for clause in spec.split(',').map(str::trim).filter(|c| !c.is_empty()) {
        let Some(caps) = CLAUSE.captures(clause) else {
            continue;
        };
        let ord = cmp(version, &caps[2]);
        let fails = match &caps[1] {
            ">=" => ord == Ordering::Less,
            "<=" => ord == Ordering::Greater,
            ">" => ord != Ordering::Greater,
            "<" => ord != Ordering::Less,
            _ => ord != Ordering::Equal,
        };
        if fails {
            return false;
        }
    }
    true
}

pub fn major_minor(version: &str) -> String {
    static MAJOR_MINOR: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(\d+)(?:\.(\d+))?").expect("static major.minor"));
    let trimmed = version.trim_start_matches(['v', 'V']);
    match MAJOR_MINOR.captures(trimmed) {
        Some(caps) => match caps.get(2) {
            Some(minor) => format!("{}.{}", &caps[1], minor.as_str()),
            None => caps[1].to_string(),
        },
        None => version.to_string(),
    }
}
