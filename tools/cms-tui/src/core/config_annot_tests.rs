//! Contract for where a config key's trailing annotation comment lives.
//!
//! `config.toml.example` doubles as the field catalog, and every key carries a
//! trailing `# <type>; ...` annotation that names its type and metadata. The
//! whole schema design depends on that annotation being readable and surviving a
//! value write, so these tests pin both facts rather than leaving them to be
//! rediscovered each time the editor crate is upgraded.

use toml_edit::{DocumentMut, Item, Value};

const ANNOTATED: &str =
    "[core]\nPOSTGRES_PORT = 5432      # port\nEMPTY_SECRET = \"\"         # secret; @gen=hex32\n";

fn parse(source: &str) -> DocumentMut {
    source.parse().expect("fixture parses")
}

fn scalar(document: &DocumentMut, key: &str) -> Value {
    document["core"][key]
        .as_value()
        .cloned()
        .expect("key is a scalar")
}

#[test]
fn trailing_annotation_lives_in_the_value_suffix() {
    let document = parse(ANNOTATED);
    let suffix = scalar(&document, "POSTGRES_PORT")
        .decor()
        .suffix()
        .map(|raw| raw.as_str().unwrap_or_default().to_string());
    assert_eq!(suffix.as_deref(), Some("      # port"));
}

#[test]
fn the_key_itself_carries_no_annotation() {
    // The key decor holds only layout whitespace — the separator before the
    // value — so a reader that looked there would find no annotation and report
    // every key as untyped. That no `#` reaches the key is the contract worth
    // pinning; the whitespace itself is layout, not metadata.
    let document = parse(ANNOTATED);
    let key = document
        .as_table()
        .get("core")
        .and_then(Item::as_table_like)
        .and_then(|table| table.key("POSTGRES_PORT"))
        .expect("key present");
    let suffix = key
        .leaf_decor()
        .suffix()
        .map(|raw| raw.as_str().unwrap_or_default());
    assert!(
        !suffix.unwrap_or_default().contains('#'),
        "the annotation must not live on the key, found {suffix:?}"
    );
}

#[test]
fn replacing_a_value_without_its_decor_drops_the_annotation() {
    // The failure this guards against is silent: the write succeeds and the
    // file still parses, but the schema metadata is gone with no error raised.
    let mut document = parse(ANNOTATED);
    document["core"]["POSTGRES_PORT"] = toml_edit::value(6000);
    assert!(!document.to_string().contains("# port"));
}

#[test]
fn replacing_a_value_with_its_decor_keeps_the_annotation() {
    let mut document = parse(ANNOTATED);
    let decor = scalar(&document, "POSTGRES_PORT").decor().clone();
    let mut replacement = Value::from(6000);
    if let Some(prefix) = decor.prefix().cloned() {
        replacement.decor_mut().set_prefix(prefix);
    }
    if let Some(suffix) = decor.suffix().cloned() {
        replacement.decor_mut().set_suffix(suffix);
    }
    document["core"]["POSTGRES_PORT"] = toml_edit::value(replacement);
    assert!(document
        .to_string()
        .contains("POSTGRES_PORT = 6000      # port"));
}

#[test]
fn reading_then_writing_an_untouched_file_is_byte_identical() {
    let document = parse(ANNOTATED);
    assert_eq!(document.to_string(), ANNOTATED);
}
