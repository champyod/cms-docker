//! The ECMAScript-layout JSON the audit chain hashes, in one place.
//!
//! `JSON.stringify` and Rust's serialisers agree on ordinary data and diverge
//! exactly where a hash cannot afford them to: number layout at the exponent
//! thresholds, and key order above the BMP. Both live here so the chain module
//! holds no byte-level rule of its own.

use std::fmt::Write as _;

use serde_json::{Number, Value};

pub(crate) fn write_value(out: &mut String, value: &Value) {
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
pub(crate) fn write_string(out: &mut String, text: &str) {
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
pub(crate) fn ecma_number(number: &Number) -> String {
    let value = number.as_f64().unwrap_or(0.0);
    ecma_f64(value)
}

/// `Number::toString` for a finite double, following ECMA-262 §6.1.6.1.20.
///
/// The shortest round-tripping digits come from Rust's `{:e}`, which emits the
/// same digit sequence the specification's algorithm selects; only the layout
/// around those digits differs, and that is what this function reproduces.
pub(crate) fn ecma_f64(value: f64) -> String {
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
    // `n` is the decimal point's position: value is digits × 10^(n − count).
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
pub(crate) fn utf16_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}
/// Deterministic JSON with object keys sorted and no whitespace, matching
/// `stableStringify` in the TypeScript recipe.
#[must_use]
pub fn stable_stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each pair was produced by `JSON.stringify` in node.
    #[test]
    fn numbers_follow_the_ecmascript_layout_at_every_threshold() {
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
