//! What each domain verb resolves to: its own dispatch key, its own catalog row, and the argv
//! its own variant sends.
//!
//! WHY the setup scope's shared flag set is tested in `resolve_setup_tests.rs`: three verbs
//! build that one flag set, so its assertions are about an encoder rather than about a verb.

use clap::Parser;

use super::{resolve_catalog, Commands};
use crate::core::dispatch::{target, DispatchKey};

#[derive(Parser)]
struct TestCli {
    #[command(subcommand)]
    command: Commands,
}

fn dispatch(argv: &[&str]) -> (DispatchKey, Vec<String>) {
    let cli = TestCli::try_parse_from(argv).expect("argv parses");
    resolve_catalog(&cli.command).expect("command is dispatched")
}

fn argv(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_string()).collect()
}

#[path = "resolve_setup_tests.rs"]
mod setup;

#[test]
fn cert_and_proxy_pass_their_verb_first() {
    for (verb, expected_key) in [
        ("cert", DispatchKey::DomainCert),
        ("proxy", DispatchKey::DomainProxy),
    ] {
        let (key, args) = dispatch(&["cms", "domain", verb, "--domain", "a.example"]);
        assert_eq!(key, expected_key);
        assert_eq!(
            args,
            argv(&[verb, "--cert", "letsencrypt", "--domain", "a.example"])
        );
    }
}

#[test]
fn check_expiry_sends_days_and_config_only() {
    let (key, args) = dispatch(&["cms", "domain", "check-expiry", "--days", "7"]);
    assert_eq!(key, DispatchKey::DomainCheckExpiry);
    assert_eq!(args, argv(&["check-expiry", "--days", "7"]));

    let (_, bare) = dispatch(&["cms", "domain", "check-expiry"]);
    assert_eq!(bare, argv(&["check-expiry"]));
}

#[test]
fn check_expiry_carries_an_alternate_env_file() {
    let (_, args) = dispatch(&["cms", "domain", "check-expiry", "--config", "/c/alt.env"]);
    assert_eq!(args, argv(&["check-expiry", "--config", "/c/alt.env"]));
}

#[test]
fn revoke_carries_reason_domain_and_mode() {
    let (key, args) = dispatch(&[
        "cms",
        "domain",
        "revoke",
        "--reason",
        "keycompromise",
        "--domain",
        "a.example",
        "--apply",
    ]);
    assert_eq!(key, DispatchKey::DomainRevoke);
    assert_eq!(
        args,
        argv(&[
            "revoke",
            "--reason",
            "keycompromise",
            "--domain",
            "a.example",
            "--apply"
        ])
    );
}

#[test]
fn revoke_dry_run_precedes_apply() {
    let (_, args) = dispatch(&["cms", "domain", "revoke", "--dry-run", "--apply"]);
    let dry_run_at = args.iter().position(|arg| arg == "--dry-run");
    let apply_at = args.iter().position(|arg| arg == "--apply");
    assert!(
        dry_run_at < apply_at,
        "the script reads the pair in argv order"
    );
}

#[test]
fn every_domain_verb_is_a_leaf_one_depth_under_domain() {
    for verb in [
        "setup",
        "cert",
        "proxy",
        "status",
        "renew",
        "preflight",
        "check-expiry",
        "revoke",
    ] {
        let (key, args) = dispatch(&["cms", "domain", verb]);
        assert_eq!(
            target(key),
            Some(&crate::core::dispatch::DispatchTarget::Script(
                "__domain.sh"
            )),
            "{verb} lost the domain script target"
        );
        assert_eq!(args[0], verb, "{verb} did not send itself to the script");
    }
}

#[test]
fn each_domain_verb_has_a_key_and_catalog_row_of_its_own() {
    let verbs = [
        "setup",
        "cert",
        "proxy",
        "status",
        "renew",
        "preflight",
        "check-expiry",
        "revoke",
    ];
    let keys: Vec<DispatchKey> = verbs
        .iter()
        .map(|verb| dispatch(&["cms", "domain", verb]).0)
        .collect();
    for (index, key) in keys.iter().enumerate() {
        assert!(
            !keys[..index].contains(key),
            "two domain verbs resolve to {key:?}"
        );
        let spec = crate::core::catalog::spec_for(*key).expect("catalog row");
        assert_eq!(
            spec.target,
            crate::core::dispatch::DispatchTarget::Script("__domain.sh"),
            "{key:?} lost the domain script target"
        );
    }
}

#[test]
fn status_renew_and_preflight_keep_their_single_argument_form() {
    assert_eq!(dispatch(&["cms", "domain", "status"]).1, argv(&["status"]));
    assert_eq!(dispatch(&["cms", "domain", "renew"]).1, argv(&["renew"]));
    assert_eq!(
        dispatch(&["cms", "domain", "preflight"]).1,
        argv(&["preflight"])
    );
}
