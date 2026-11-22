//! The registry's own rule: one name, one entry, and the gate it was given.

use cms_proto::{Decision, GateConfig};
use cms_svc::{DuplicateMethod, Registry};
use serde_json::{json, Value};

/// A handler that answers with a value only a caller that reached it can see.
fn echo(_data: &Value) -> Result<Value, String> {
    Ok(json!("echoed"))
}

fn entry(name: &'static str) -> cms_proto::Method {
    cms_proto::Method {
        name,
        is_callable: true,
        handler: echo,
    }
}

fn config(secret: Option<&str>) -> GateConfig<'_> {
    GateConfig {
        secret,
        is_backdoor_enabled: false,
    }
}

#[test]
fn a_name_registered_twice_is_refused() {
    let Err(refused) = Registry::new(vec![entry("echo"), entry("echo")], config(None)) else {
        panic!("the second entry could never be reached");
    };

    assert_eq!(refused, DuplicateMethod("echo"));
    assert_eq!(refused.to_string(), "method `echo` is registered twice");
}

#[test]
fn the_gate_decides_with_the_secret_the_registry_was_built_with() {
    let registry = Registry::new(vec![entry("echo")], config(Some("correct horse")))
        .expect("the names are unique");

    let anonymous = registry.decide(&json!({"__id": "7", "__method": "echo", "__data": {}}));
    let authenticated = registry.decide(&json!({
        "__id": "7",
        "__method": "echo",
        "__data": {},
        "__secret": "correct horse",
    }));

    let Decision::Answered(refused) = anonymous else {
        panic!("a message the gate refuses is answered, not dropped");
    };
    let Decision::Answered(answered) = authenticated else {
        panic!("a call the gate lets through is answered");
    };
    assert_eq!(refused.error, Some(json!("RPC authentication failed.")));
    assert_eq!(answered.error, None);
    assert_eq!(answered.data, json!("echoed"));
    assert_eq!(registry.methods().len(), 1);
    assert_eq!(registry.gate().secret, Some("correct horse"));
}
