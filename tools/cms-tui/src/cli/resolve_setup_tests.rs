//! What the setup scope's shared flag set encodes: the argv order the script reads, the flags
//! an unset row must not send, and the values clap must reject.
//!
//! WHY these are separate from the per-verb tests: every verb that carries flags builds the
//! same `DomainSetupFlags`, so these assertions cover one encoder used by three verbs. Read
//! beside the per-verb key and catalog tests they would be indistinguishable from tests
//! about verbs that take no flags at all.

use super::{argv, dispatch, TestCli};
use crate::core::dispatch::DispatchKey;
use clap::Parser;

#[test]
fn setup_defaults_to_letsencrypt() {
    let (key, args) = dispatch(&["cms", "domain", "setup"]);
    assert_eq!(key, DispatchKey::DomainSetup);
    assert_eq!(args, argv(&["setup", "--cert", "letsencrypt"]));
}

#[test]
fn setup_carries_every_flag_the_script_reads() {
    let (key, args) = dispatch(&[
        "cms",
        "domain",
        "setup",
        "--cert",
        "provided",
        "--domain",
        "a.example",
        "--admin-domain",
        "adm.example",
        "--oj-domain",
        "oj.example",
        "--ranking-domain",
        "rank.example",
        "--cert-path",
        "/c/fullchain.pem",
        "--key-path",
        "/c/privkey.pem",
        "--email",
        "ops@example",
        "--dry-run",
        "--apply",
        "--yes",
        "--auto-retry",
        "--retry-attempts",
        "3",
        "--retry-interval",
        "20",
        "--retry-forever",
        "--extra-domains",
        "x.example y.example",
        "--deploy-hook",
        "systemctl reload nginx",
        "--staging",
        "--force",
        "--wait-port80",
        "45",
        "--backup-certs",
        "--lock",
        "--json",
        "--days",
        "14",
        "--reason",
        "keycompromise",
        "--dns",
        "cloudflare",
        "--dns-credentials",
        "/c/creds.ini",
        "--config",
        "/c/alt.env",
    ]);
    assert_eq!(key, DispatchKey::DomainSetup);
    assert_eq!(
        args,
        argv(&[
            "setup",
            "--cert",
            "provided",
            "--domain",
            "a.example",
            "--admin-domain",
            "adm.example",
            "--oj-domain",
            "oj.example",
            "--ranking-domain",
            "rank.example",
            "--cert-path",
            "/c/fullchain.pem",
            "--key-path",
            "/c/privkey.pem",
            "--email",
            "ops@example",
            "--extra-domains",
            "x.example y.example",
            "--deploy-hook",
            "systemctl reload nginx",
            "--reason",
            "keycompromise",
            "--dns",
            "cloudflare",
            "--dns-credentials",
            "/c/creds.ini",
            "--config",
            "/c/alt.env",
            "--retry-attempts",
            "3",
            "--retry-interval",
            "20",
            "--wait-port80",
            "45",
            "--days",
            "14",
            "--dry-run",
            "--apply",
            "--yes",
            "--auto-retry",
            "--retry-forever",
            "--staging",
            "--force",
            "--backup-certs",
            "--lock",
            "--json",
        ])
    );
}

#[test]
fn dry_run_precedes_apply_so_the_script_applies() {
    let (_, args) = dispatch(&["cms", "domain", "setup", "--dry-run", "--apply"]);
    let dry_run_at = args.iter().position(|arg| arg == "--dry-run");
    let apply_at = args.iter().position(|arg| arg == "--apply");
    assert!(
        dry_run_at < apply_at,
        "the script reads the pair in argv order"
    );
}

#[test]
fn unset_flags_are_omitted_so_the_script_defaults_apply() {
    let (_, args) = dispatch(&["cms", "domain", "setup"]);
    for absent in [
        "--domain", "--days", "--reason", "--dns", "--config", "--apply", "--json",
    ] {
        assert!(
            !args.iter().any(|arg| arg == absent),
            "{absent} was sent although it was never given"
        );
    }
}

#[test]
fn short_yes_is_accepted() {
    let (_, args) = dispatch(&["cms", "domain", "setup", "-y"]);
    assert!(args.contains(&"--yes".to_string()));
}

#[test]
fn numeric_flags_reject_a_non_number() {
    assert!(
        TestCli::try_parse_from(["cms", "domain", "setup", "--retry-attempts", "many"]).is_err()
    );
    assert!(TestCli::try_parse_from(["cms", "domain", "check-expiry", "--days", "-1"]).is_err());
}
