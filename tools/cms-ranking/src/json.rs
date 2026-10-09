use std::io;

use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::http::refuse;

/// The captured baseline is Python's json.dumps default, whose separators are
/// ", " between items and ": " after a key. serde_json's compact formatter uses
/// neither, so overriding the separators is what makes a byte comparison against
/// the capture meaningful.
pub struct PythonFormatter;

impl serde_json::ser::Formatter for PythonFormatter {
    fn begin_array_value<W>(&mut self, writer: &mut W, first: bool) -> io::Result<()>
    where
        W: ?Sized + io::Write,
    {
        if first {
            Ok(())
        } else {
            writer.write_all(b", ")
        }
    }

    fn begin_object_key<W>(&mut self, writer: &mut W, first: bool) -> io::Result<()>
    where
        W: ?Sized + io::Write,
    {
        if first {
            Ok(())
        } else {
            writer.write_all(b", ")
        }
    }

    fn begin_object_value<W>(&mut self, writer: &mut W) -> io::Result<()>
    where
        W: ?Sized + io::Write,
    {
        writer.write_all(b": ")
    }
}

pub fn to_bytes<T: Serialize>(value: &T) -> serde_json::Result<Vec<u8>> {
    let mut serializer = serde_json::Serializer::with_formatter(Vec::new(), PythonFormatter);
    value.serialize(&mut serializer)?;
    Ok(serializer.into_inner())
}

/// A JSON body that already went through the formatter, so a streaming handler
/// builds the bytes once and only attaches headers.
pub fn bytes_response(body: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], body).into_response()
}

pub fn json_response<T: Serialize>(value: &T) -> Response {
    match to_bytes(value) {
        Ok(body) => bytes_response(body),
        Err(error) => refuse(&error.to_string()),
    }
}

/// The Python service puts this header only on /scores and the entity routes, so
/// the callers choose it rather than every response getting one.
pub fn stamped(mut response: Response) -> Response {
    if let Ok(value) = HeaderValue::from_str(&now_stamp()) {
        response.headers_mut().insert("Timestamp", value);
    }
    response
}

pub fn stamped_json<T: Serialize>(value: &T) -> Response {
    stamped(json_response(value))
}

/// The capture spells this as seconds since the epoch to exactly six places.
fn now_stamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(elapsed) => format!("{}.{:06}", elapsed.as_secs(), elapsed.subsec_micros()),
        Err(_) => "0.000000".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendered(value: &serde_json::Value) -> String {
        String::from_utf8(to_bytes(value).expect("the value serialises")).expect("utf-8")
    }

    #[test]
    fn the_separators_match_python_json_dumps() {
        let value = serde_json::json!([1, 2, {"a": true}]);
        assert_eq!(rendered(&value), r#"[1, 2, {"a": true}]"#);
    }

    #[test]
    fn nothing_is_written_across_lines() {
        let value = serde_json::json!([[1, 2], {"a": 3, "b": 4}]);
        assert!(!rendered(&value).contains('\n'));
    }
}
