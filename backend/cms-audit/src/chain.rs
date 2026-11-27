//! The audit log's hash chain, byte-identical to the panel's TypeScript recipe.
//!
//! `admin-panel/src/lib/audit-chain.ts` is the one implementation the panel's
//! writer and verifier share. This module is the Rust half of that same chain,
//! and it must produce the same bytes or the two writers would fail each
//! other's rows for reasons that are not tampering: a verifier that disagrees
//! with its writer is the same as having no verifier.
//!
//! Two details make "the same bytes" harder than it looks, and both are why
//! this module does not lean on a JSON serialiser:
//!
//! * `JSON.stringify` renders a number by the ECMAScript `Number::toString`
//!   rule, which differs from every Rust formatter at the edges: `1e21` is
//!   `1e+21` there, `1e20` is 21 digits, and `1e-7` keeps its exponent while
//!   `1e-6` does not. [`ecma_number`] reproduces that rule.
//! * A JSON number is a float64 as far as the chain is concerned. `JSON.parse`
//!   has already rounded anything beyond 2^53 before the panel hashes it, so
//!   this module rounds the same way rather than hashing a more exact value
//!   the panel could never produce.
//!
//! Object keys are ordered by UTF-16 code unit, because that is `Array#sort`
//! on `Object.keys`, and it is not the same order as UTF-8 or scalar order for
//! a key above the BMP.

use std::fmt::Write as _;

use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

/// A log row's hash commits to exactly these fields; `id` and `timestamp` are
/// database-assigned and checked by the id sequence instead.
#[derive(Debug, Clone, PartialEq)]
pub struct AuditPayload {
    pub actor_id: Option<i32>,
    pub after_values: Option<Value>,
    pub before_values: Option<Value>,
    pub entity: String,
    pub entity_id: Option<String>,
    pub ip: Option<String>,
    pub reason: Option<String>,
    pub result: String,
    pub session_id: Option<String>,
    pub verb: String,
}

/// The canonical form of a row's payload: the JSON its hash is taken over.
///
/// Must stay byte-identical to `canonicaliseAuditRow` in
/// `admin-panel/src/lib/audit-chain.ts`.
#[must_use]
pub fn canonicalise(row: &AuditPayload) -> String {
    let mut fields: Vec<(&str, Value)> = vec![
        ("actor_id", optional(optional_number(row.actor_id))),
        ("after_values", optional(row.after_values.clone())),
        ("before_values", optional(row.before_values.clone())),
        ("entity", Value::String(row.entity.clone())),
        (
            "entity_id",
            optional(optional_string(row.entity_id.as_deref())),
        ),
        ("ip", optional(optional_string(row.ip.as_deref()))),
        ("reason", optional(optional_string(row.reason.as_deref()))),
        ("result", Value::String(row.result.clone())),
        (
            "session_id",
            optional(optional_string(row.session_id.as_deref())),
        ),
        ("verb", Value::String(row.verb.clone())),
    ];
    // The payload is emitted in key order, so this is the sort that decides it.
    fields.sort_by(|left, right| utf16_cmp(left.0, right.0));
    let mut object = Map::new();
    for (key, value) in fields {
        object.insert(key.to_string(), value);
    }
    stable_stringify(&Value::Object(object))
}

/// `SHA-256` over `previousHash|canonicalPayload`, lowercase hex.
///
/// Must stay byte-identical to `computeEntryHash` in
/// `admin-panel/src/lib/audit-chain.ts`.
#[must_use]
pub fn compute_entry_hash(previous_hash: Option<&str>, canonical_payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(previous_hash.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(canonical_payload.as_bytes());
    hex(&hasher.finalize())
}

/// Deterministic JSON with object keys sorted and no whitespace, matching
/// `stableStringify` in the TypeScript recipe.
#[must_use]
pub fn stable_stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&ecma_number(number)),
        Value::String(text) => write_string(out, text),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(object) => {
            let mut entries: Vec<(&String, &Value)> = object.iter().collect();
            entries.sort_by(|left, right| utf16_cmp(left.0, right.0));
            out.push('{');
            for (index, (key, item)) in entries.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write_value(out, item);
            }
            out.push('}');
        }
    }
}

/// A JSON string as `JSON.stringify` writes it: the two mandatory escapes plus
/// the five named control escapes, every other control below `0x20` as
/// `\u00XX`, and nothing else touched — not `/`, not DEL, not non-ASCII.
fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", control as u32);
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

/// The ECMAScript `Number::toString` rendering of one JSON number.
///
/// The value is rounded to `f64` first, because `JSON.parse` has already done
/// so by the time the panel hashes the row: an integer beyond 2^53 reaches the
/// panel as the nearest representable double and must be hashed as that.
fn ecma_number(number: &Number) -> String {
    let value = number.as_f64().unwrap_or(0.0);
    ecma_f64(value)
}

/// `Number::toString` for a finite double, following ECMA-262 §6.1.6.1.20.
///
/// The shortest round-tripping digits come from Rust's `{:e}`, which emits the
/// same digit sequence the specification's algorithm selects; only the layout
/// around those digits differs, and that is what this function reproduces.
fn ecma_f64(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    let negative = value < 0.0;
    let rendered = format!("{:e}", value.abs());
    let (mantissa, exponent) = rendered
        .split_once('e')
        .expect("`{:e}` always renders an exponent");
    let exponent: i32 = exponent.parse().expect("`{:e}` always renders a number");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let count = digits.len() as i32;
    // `n` is where the decimal point sits relative to the digits: value is
    // digits × 10^(n − count).
    let n = exponent + 1;

    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if count <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - count) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if count > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let power = n - 1;
        out.push(if power < 0 { '-' } else { '+' });
        let _ = write!(out, "{}", power.abs());
    }
    out
}

/// `Array#sort` on `Object.keys` compares UTF-16 code units, which differs from
/// scalar order for a key above the BMP.
fn utf16_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn optional(value: Option<Value>) -> Value {
    value.unwrap_or(Value::Null)
}

fn optional_number(value: Option<i32>) -> Option<Value> {
    value.map(|number| Value::Number(Number::from(number)))
}

fn optional_string(value: Option<&str>) -> Option<Value> {
    value.map(|text| Value::String(text.to_string()))
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Every expected value below was produced by running the panel's own
    /// `admin-panel/src/lib/audit-chain.ts` under `bun`, not by hand.
    #[test]
    fn the_canonical_form_matches_the_panel_byte_for_byte() {
        let row = AuditPayload {
            actor_id: None,
            after_values: Some(json!({ "b": 2, "a": [1, null, "x"] })),
            before_values: None,
            entity: "submission_results".to_string(),
            entity_id: Some("41/9".to_string()),
            ip: None,
            reason: Some("judging commit".to_string()),
            result: "ok".to_string(),
            session_id: None,
            verb: "evaluation:create".to_string(),
        };
        assert_eq!(
            canonicalise(&row),
            concat!(
                r#"{"actor_id":null,"after_values":{"a":[1,null,"x"],"b":2},"#,
                r#""before_values":null,"entity":"submission_results","entity_id":"41/9","#,
                r#""ip":null,"reason":"judging commit","result":"ok","session_id":null,"#,
                r#""verb":"evaluation:create"}"#
            )
        );
    }

    #[test]
    fn the_genesis_and_chained_hashes_match_the_panel() {
        let canonical = concat!(
            r#"{"actor_id":null,"after_values":{"a":[1,null,"x"],"b":2},"#,
            r#""before_values":null,"entity":"submission_results","entity_id":"41/9","#,
            r#""ip":null,"reason":"judging commit","result":"ok","session_id":null,"#,
            r#""verb":"evaluation:create"}"#
        );
        assert_eq!(
            compute_entry_hash(None, canonical),
            "d21834431d32c97f239ec34cdf941a77e45f1d78dcd291b7c55acf5fe01e0804"
        );
        assert_eq!(
            compute_entry_hash(Some("deadbeef"), canonical),
            "773aec56ec9ecc3e5f1e95d1caee94a56442aaab3d7062089e1dfbfc411310a3"
        );
    }

    #[test]
    fn a_number_beyond_two_to_the_fifty_third_rounds_like_json_parse() {
        let row = AuditPayload {
            actor_id: Some(7),
            after_values: Some(json!({
                "score": 12.5,
                "big": 9007199254740993_i64,
                "ts": "2026-11-27T05:00:00.000Z"
            })),
            before_values: Some(json!({ "score": null })),
            entity: "evaluations".to_string(),
            entity_id: Some("41/9/3".to_string()),
            ip: Some("10.0.0.5".to_string()),
            reason: None,
            result: "ok".to_string(),
            session_id: Some("sess-1".to_string()),
            verb: "evaluation:create".to_string(),
        };
        let canonical = canonicalise(&row);
        assert_eq!(
            canonical,
            concat!(
                r#"{"actor_id":7,"after_values":{"big":9007199254740992,"score":12.5,"#,
                r#""ts":"2026-11-27T05:00:00.000Z"},"before_values":{"score":null},"#,
                r#""entity":"evaluations","entity_id":"41/9/3","ip":"10.0.0.5","reason":null,"#,
                r#""result":"ok","session_id":"sess-1","verb":"evaluation:create"}"#
            )
        );
        assert_eq!(
            compute_entry_hash(Some("abc123"), &canonical),
            "2d33ee1fd7eafebd20898c0978fe66a5aadbd1c7e8248a531b830c97e36411ec"
        );
    }

    #[test]
    fn strings_and_key_order_match_json_stringify() {
        assert_eq!(
            stable_stringify(&json!({ "é": "ü", "z": 1, "a": true, "n": null })),
            "{\"a\":true,\"n\":null,\"z\":1,\"é\":\"ü\"}"
        );
        assert_eq!(
            stable_stringify(&json!("a\x08\u{c}\n\r\t\u{1}z\u{1f}/\u{7f}é")),
            "\"a\\b\\f\\n\\r\\t\\u0001z\\u001f/\u{7f}é\""
        );
    }

    /// `Array#sort` on `Object.keys` compares UTF-16 code units. Rust's `str`
    /// order would put U+FFFD before U+1F600; JavaScript puts it after, because
    /// the astral character is a surrogate pair starting at 0xD83D.
    #[test]
    fn keys_sort_by_utf16_code_unit_not_scalar_value() {
        assert_eq!(
            stable_stringify(&json!({ "\u{fffd}": 1, "\u{1f600}": 2, "a": 3 })),
            "{\"a\":3,\"\u{1f600}\":2,\"\u{fffd}\":1}"
        );
    }

    #[test]
    fn numbers_follow_the_ecmascript_layout_at_every_threshold() {
        // Each pair was produced by `JSON.stringify` in node.
        let cases = [
            (12.5_f64, "12.5"),
            (2048.0, "2048"),
            (0.1, "0.1"),
            (0.5, "0.5"),
            (100.0, "100"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (123456789012345680000.0, "123456789012345680000"),
        ];
        for (value, expected) in cases {
            assert_eq!(ecma_f64(value), expected, "rendering {value}");
        }
    }
}
