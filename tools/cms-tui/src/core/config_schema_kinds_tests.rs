//! Unit tests for the annotation vocabulary tokens.

use super::{Generator, Scope, ValueType};

#[test]
fn parses_every_declared_value_type() {
    assert_eq!(ValueType::parse("str"), Some(ValueType::Str));
    assert_eq!(ValueType::parse("num"), Some(ValueType::Num));
    assert_eq!(ValueType::parse("bool"), Some(ValueType::Bool));
    assert_eq!(ValueType::parse("port"), Some(ValueType::Port));
    assert_eq!(ValueType::parse("url"), Some(ValueType::Url));
    assert_eq!(ValueType::parse("secret"), Some(ValueType::Secret));
    assert_eq!(ValueType::parse("enum:0,1"), Some(ValueType::Enum));
}

#[test]
fn an_unknown_type_token_is_not_a_type() {
    assert_eq!(ValueType::parse("contestants"), None);
    assert_eq!(ValueType::parse(""), None);
}

#[test]
fn accepts_values_within_each_type() {
    assert!(ValueType::Num.accepts("5432"));
    assert!(ValueType::Bool.accepts("true"));
    assert!(ValueType::Port.accepts("8888"));
    assert!(ValueType::Url.accepts("https://cms.local"));
    assert!(ValueType::Str.accepts("anything at all"));
}

#[test]
fn rejects_values_outside_each_type() {
    assert!(!ValueType::Num.accepts("54a2"));
    assert!(!ValueType::Bool.accepts("yes"));
    assert!(!ValueType::Port.accepts("70000"));
    assert!(!ValueType::Port.accepts("0"));
    assert!(!ValueType::Url.accepts("cms.local"));
}

#[test]
fn an_empty_value_is_accepted_so_the_resolver_can_fall_back() {
    // Empty is not a parse failure: it is the signal to consult the next layer.
    for kind in [
        ValueType::Num,
        ValueType::Bool,
        ValueType::Port,
        ValueType::Url,
        ValueType::Enum,
    ] {
        assert!(kind.accepts(""), "{kind:?} must accept empty");
        assert!(kind.accepts("   "), "{kind:?} must accept blank");
    }
}

#[test]
fn scope_defaults_to_stack_and_parses_the_named_layers() {
    assert_eq!(Scope::parse("base"), Scope::Base);
    assert_eq!(Scope::parse("stack"), Scope::Stack);
    assert_eq!(Scope::parse("instance"), Scope::Instance);
    assert_eq!(Scope::parse("nonsense"), Scope::Stack);
}

#[test]
fn parses_each_generator_token() {
    assert_eq!(Generator::parse("hex32"), Generator::Hex32);
    assert_eq!(Generator::parse("rand_pw"), Generator::RandPw);
    assert_eq!(Generator::parse("live_ip"), Generator::LiveIp);
    assert_eq!(Generator::parse("docker_gid"), Generator::DockerGid);
}

#[test]
fn a_mirror_generator_names_its_source_key() {
    assert_eq!(Generator::parse("mirror:PUBLIC_IP"), Generator::Mirror);
    assert_eq!(
        Generator::mirror_source("mirror:PUBLIC_IP"),
        Some("PUBLIC_IP")
    );
}

#[test]
fn an_unknown_generator_token_generates_nothing() {
    assert_eq!(Generator::parse("nonsense"), Generator::None);
    assert_eq!(Generator::parse("mirror:"), Generator::None);
    assert_eq!(Generator::parse(""), Generator::None);
    assert_eq!(Generator::mirror_source("nonsense"), None);
    assert_eq!(Generator::mirror_source("hex32"), None);
}
