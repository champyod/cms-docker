//! Unit tests for the config catalog parser.
//!
//! The fixtures are cut-down versions of the real `config.toml.example`
//! annotations, because the annotation grammar is the contract between the file
//! a human edits and the typed schema every layer reads.

use super::{Generator, KeySpec, Schema, SchemaError, Scope, ValueType};

const ANNOTATED: &str = "\
[core]
POSTGRES_PORT = 5432            # port
POSTGRES_PASSWORD = \"\"         # secret; @gen=rand_pw; @req
CMS_DOMAIN = \"cms.local\"        # str; @scope=base; @fallback=NONE
CONTEST_DOMAIN = \"\"            # str; @fallback=CMS_DOMAIN; contestants use this
DOCKER_GID = 999                # num; @gen=docker_gid
PUBLIC_IP = \"0.0.0.0\"          # str; @gen=live_ip
SHARD_HOST = \"\"                # str; @gen=mirror:PUBLIC_IP
BARE_VALUE = \"md5\"
HARDENED = 0                    # enum:0,1; @scope=instance; warning: tune first
SUBMIT_LOCAL = true             # bool
";

fn spec<'a>(schema: &'a Schema, name: &str) -> &'a KeySpec {
    schema.get("core", name).expect("key is declared")
}

#[test]
fn parses_the_declared_type() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(spec(&schema, "POSTGRES_PORT").value_type, ValueType::Port);
    assert_eq!(
        spec(&schema, "POSTGRES_PASSWORD").value_type,
        ValueType::Secret
    );
    assert_eq!(spec(&schema, "DOCKER_GID").value_type, ValueType::Num);
    assert_eq!(spec(&schema, "SUBMIT_LOCAL").value_type, ValueType::Bool);
    assert_eq!(spec(&schema, "HARDENED").value_type, ValueType::Enum);
}

#[test]
fn an_unannotated_key_is_typed_as_free_text() {
    // The shipped example leaves 35 keys with no annotation, so a bare key is
    // normal input rather than a malformed file.
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(spec(&schema, "BARE_VALUE").value_type, ValueType::Str);
}

#[test]
fn reads_required_generator_and_scope() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    let password = spec(&schema, "POSTGRES_PASSWORD");
    assert!(password.required, "a secret marked @req must be required");
    assert_eq!(password.generator, Generator::RandPw);

    assert_eq!(spec(&schema, "CMS_DOMAIN").scope, Scope::Base);
    assert_eq!(spec(&schema, "HARDENED").scope, Scope::Instance);
    assert_eq!(spec(&schema, "DOCKER_GID").scope, Scope::Stack);
}

#[test]
fn resolves_each_generator_token() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(spec(&schema, "DOCKER_GID").generator, Generator::DockerGid);
    assert_eq!(spec(&schema, "PUBLIC_IP").generator, Generator::LiveIp);
    assert_eq!(spec(&schema, "BARE_VALUE").generator, Generator::None);
    assert_eq!(spec(&schema, "SHARD_HOST").generator, Generator::Mirror);
    assert_eq!(
        spec(&schema, "SHARD_HOST").mirror_source.as_deref(),
        Some("PUBLIC_IP")
    );
}

#[test]
fn a_fallback_of_none_means_no_fallback() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(spec(&schema, "CMS_DOMAIN").fallback, None);
}

#[test]
fn a_named_fallback_is_kept() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(
        spec(&schema, "CONTEST_DOMAIN").fallback.as_deref(),
        Some("CMS_DOMAIN")
    );
}

#[test]
fn keeps_free_prose_outside_at_tokens() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(
        spec(&schema, "CONTEST_DOMAIN").description,
        "contestants use this"
    );
    assert_eq!(spec(&schema, "HARDENED").description, "warning: tune first");
}

#[test]
fn the_default_is_the_unquoted_value() {
    // A default taken from the rendered form would carry the annotation and the
    // alignment padding along with the value.
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(spec(&schema, "CMS_DOMAIN").default, "cms.local");
    assert_eq!(spec(&schema, "POSTGRES_PORT").default, "5432");
    assert_eq!(spec(&schema, "SUBMIT_LOCAL").default, "true");
    assert_eq!(spec(&schema, "BARE_VALUE").default, "md5");
    assert_eq!(spec(&schema, "POSTGRES_PASSWORD").default, "");
}

#[test]
fn a_hash_inside_a_quoted_value_is_not_read_as_an_annotation() {
    let schema = Schema::parse("[a]\nPASSWORD = \"a#b\"  # str; secret-ish\n").expect("parses");
    let key = schema.get("a", "PASSWORD").expect("declared");
    assert_eq!(key.default, "a#b");
    assert_eq!(key.value_type, ValueType::Str);
    assert_eq!(key.description, "secret-ish");
}

#[test]
fn keys_are_indexed_by_section_and_by_qualified_id() {
    let schema = Schema::parse(ANNOTATED).expect("parses");
    assert_eq!(schema.len(), 10);
    assert!(schema.get("core", "ABSENT").is_none());
    assert!(schema.get_by_id("core.POSTGRES_PORT").is_some());
    assert!(schema.get_by_id("POSTGRES_PORT").is_none());
    assert_eq!(schema.keys().count(), schema.len());
}

#[test]
fn reports_invalid_toml_rather_than_returning_an_empty_catalog() {
    let outcome = Schema::parse("[core\nthis is = = not toml");
    assert!(matches!(outcome, Err(SchemaError::Parse(_))));
}

#[test]
fn a_non_table_section_is_rejected() {
    let outcome = Schema::parse("core = 5\n");
    assert!(matches!(outcome, Err(SchemaError::NotATable { .. })));
}

/// The shipped example must parse as a catalog; every later layer trusts it.
#[test]
fn the_shipped_example_parses_and_declares_every_key() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config.toml.example");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let schema = Schema::parse(&source).expect("the shipped example is a valid catalog");
    assert!(schema.len() >= 100, "catalog lost keys: {}", schema.len());
    for section in [
        "core",
        "admin",
        "rpc",
        "contest",
        "worker",
        "infra",
        "tailscale",
    ] {
        assert!(
            schema.keys().any(|key| key.section == section),
            "section [{section}] is missing from the catalog"
        );
    }
}
