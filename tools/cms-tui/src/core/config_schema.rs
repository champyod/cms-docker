//! Parses `config.toml.example` into a typed field catalog.
//!
//! The example file is the single source of truth for what a config key means:
//! its type, whether it is required, how a missing value is generated, which
//! scope it belongs to, and which key it falls back to. Each of those lives in a
//! trailing `#` annotation on the key's own line, so the file stays readable and
//! editable by hand while still being machine-readable.
//!
//! ```text
//! POSTGRES_PORT = 5432            # port
//! POSTGRES_PASSWORD = ""          # secret; @gen=rand_pw; @req
//! CMS_DOMAIN = "cms.local"        # str; @scope=base
//! CONTEST_DOMAIN = ""            # str; @fallback=CMS_DOMAIN
//! ```
//!
//! The leading token before the first `;` is the value type. Remaining tokens
//! starting with `@` are metadata; any other token is free prose kept as the
//! description. A key with no annotation is legal — the shipped example leaves
//! 35 keys bare — so its type falls back to `str`.

use std::collections::BTreeMap;
use std::fmt;

use super::config_schema_kinds::{Generator, Scope, ValueType};

/// Everything the catalog says about one config key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeySpec {
    /// Key name as written in the file, e.g. `POSTGRES_PORT`.
    pub name: String,
    /// Table the key is declared under, e.g. `core`.
    pub section: String,
    /// Value domain the key accepts.
    pub value_type: ValueType,
    /// Whether the key must hold a value.
    pub required: bool,
    /// How an empty value is filled in.
    pub generator: Generator,
    /// Key whose value a [`Generator::Mirror`] copies, when set.
    pub mirror_source: Option<String>,
    /// Resolver layer the key is declared at.
    pub scope: Scope,
    /// Key this one falls back to when unset, when set.
    pub fallback: Option<String>,
    /// The value shipped in the example, which is also the built-in default.
    pub default: String,
    /// Free prose from the annotation.
    pub description: String,
}

/// Failure to read a catalog that cannot be trusted as the source of truth.
#[derive(Debug)]
pub enum SchemaError {
    /// The example file could not be parsed as TOML.
    Parse(toml_edit::TomlError),
    /// The file held a section whose body was not a table of scalar keys.
    NotATable { section: String },
}

impl fmt::Display for SchemaError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parse(source) => {
                write!(formatter, "config.toml.example is not valid TOML: {source}")
            }
            Self::NotATable { section } => {
                write!(
                    formatter,
                    "section [{section}] is not a table of config keys"
                )
            }
        }
    }
}

impl std::error::Error for SchemaError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Parse(source) => Some(source),
            Self::NotATable { .. } => None,
        }
    }
}

/// The whole catalog, indexed for lookup by `section.key`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Schema {
    keys: BTreeMap<String, KeySpec>,
}

impl Schema {
    /// Parses the catalog from example-file text.
    ///
    /// # Errors
    ///
    /// Returns [`SchemaError::Parse`] when the text is not valid TOML and
    /// [`SchemaError::NotATable`] when a `[section]` header holds a non-table.
    pub fn parse(source: &str) -> Result<Self, SchemaError> {
        let document = source
            .parse::<toml_edit::DocumentMut>()
            .map_err(SchemaError::Parse)?;
        let mut keys = BTreeMap::new();
        for (section, item) in document.as_table().iter() {
            let table = item.as_table_like().ok_or_else(|| SchemaError::NotATable {
                section: section.to_string(),
            })?;
            for (name, value_item) in table.iter() {
                let Some(value) = value_item.as_value() else {
                    continue;
                };
                keys.insert(
                    format!("{section}.{name}"),
                    build_key_spec(section, name, value),
                );
            }
        }
        Ok(Self { keys })
    }

    /// Returns every declared key, ordered by `section.key`.
    pub fn keys(&self) -> impl Iterator<Item = &KeySpec> {
        self.keys.values()
    }

    /// Returns the spec for `section.key`, if declared.
    #[must_use]
    pub fn get(&self, section: &str, name: &str) -> Option<&KeySpec> {
        self.keys.get(&format!("{section}.{name}"))
    }

    /// Returns the spec stored under the qualified `section.key` id.
    #[must_use]
    pub fn get_by_id(&self, id: &str) -> Option<&KeySpec> {
        self.keys.get(id)
    }

    /// Number of declared keys.
    #[must_use]
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    /// Whether the catalog declares no keys at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
}

/// Reads one key's trailing annotation into a spec.
fn build_key_spec(section: &str, name: &str, value: &toml_edit::Value) -> KeySpec {
    let mut tokens = trailing_comment(value).split(';').map(str::trim);
    let value_type = ValueType::parse(tokens.next().unwrap_or_default()).unwrap_or(ValueType::Str);
    let mut spec = KeySpec {
        name: name.to_string(),
        section: section.to_string(),
        value_type,
        required: false,
        generator: Generator::None,
        mirror_source: None,
        scope: Scope::Stack,
        fallback: None,
        default: scalar_text(value),
        description: String::new(),
    };
    let mut prose: Vec<&str> = Vec::new();
    for token in tokens {
        match token {
            "" => {}
            "@req" => spec.required = true,
            t if t.starts_with("@scope=") => {
                spec.scope = Scope::parse(t.trim_start_matches("@scope="));
            }
            t if t.starts_with("@gen=") => {
                let name = t.trim_start_matches("@gen=");
                spec.generator = Generator::parse(name);
                spec.mirror_source = Generator::mirror_source(name).map(str::to_string);
            }
            t if t.starts_with("@fallback=") => {
                spec.fallback = non_empty(t.trim_start_matches("@fallback="));
            }
            t => prose.push(t),
        }
    }
    spec.description = prose.join("; ");
    spec
}

/// Returns the `#`-comment text from a value's decor suffix, without the `#`.
fn trailing_comment(value: &toml_edit::Value) -> &str {
    let Some(suffix) = value.decor().suffix() else {
        return "";
    };
    let raw = suffix.as_str().unwrap_or_default();
    match raw.split_once('#') {
        Some((_, comment)) => comment.trim(),
        None => "",
    }
}

/// Extracts a scalar's semantic text, never its rendered form.
///
/// `Value::to_string` includes the surrounding decor, so a rendered value would
/// carry the annotation itself and any alignment padding. Quoted strings are
/// unquoted here so the default matches what a user types.
fn scalar_text(value: &toml_edit::Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(flag) = value.as_bool() {
        return flag.to_string();
    }
    if let Some(number) = value.as_integer() {
        return number.to_string();
    }
    if let Some(number) = value.as_float() {
        return number.to_string();
    }
    value.to_string().trim().to_string()
}

/// Returns `Some(text)` unless `text` is empty, treating `NONE` as absent.
fn non_empty(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "NONE" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
#[path = "config_schema_tests.rs"]
mod tests;
