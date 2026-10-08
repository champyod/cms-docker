use super::resolve_catalog;

// Parses a full `cms …` argv the same way `main` does, so the assertions
// exercise the real clap `Config` shape (trailing-var-arg forwarding).
fn parse(argv: &[&str]) -> Option<(crate::core::dispatch::DispatchKey, Vec<String>)> {
    let parsed = <crate::Args as clap::Parser>::try_parse_from(argv).expect("parse ok");
    resolve_catalog(&parsed.command.expect("has command"))
}

#[test]
fn config_sync_forwards_no_args() {
    let (key, args) = parse(&["cms", "config", "sync"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::ConfigSync);
    assert!(args.is_empty());
}

#[test]
fn config_sync_forwards_dry_run() {
    let (key, args) = parse(&["cms", "config", "sync", "--dry-run"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::ConfigSync);
    assert_eq!(args, vec!["--dry-run".to_string()]);
}

#[test]
fn config_sync_forwards_dry_run_and_no_secrets() {
    let (key, args) =
        parse(&["cms", "config", "sync", "--dry-run", "--no-secrets"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::ConfigSync);
    assert_eq!(
        args,
        vec!["--dry-run".to_string(), "--no-secrets".to_string()]
    );
}

#[test]
fn domain_setup_keeps_its_original_shape_when_nothing_extra_is_asked() {
    let (key, args) = parse(&["cms", "domain", "setup"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainSetup);
    assert_eq!(args, vec!["setup"]);
}

#[test]
fn domain_setup_forwards_every_advanced_flag() {
    let (key, args) = parse(&[
        "cms",
        "domain",
        "setup",
        "--domain",
        "grader.example.org",
        "--auto-retry",
        "--retry-attempts",
        "20",
        "--retry-interval",
        "30",
        "--wait-port80",
        "60",
        "--extra-domains",
        "a.example.org b.example.org",
        "--dns",
        "cloudflare",
        "--dns-credentials",
        "/tmp/cf.ini",
        "--staging",
        "--deploy-hook",
        "systemctl reload nginx",
        "--force",
        "--backup-certs",
        "--lock",
        "--apply",
        "-y",
    ])
    .expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainSetup);
    assert_eq!(
        args,
        vec![
            "setup",
            "--domain",
            "grader.example.org",
            "--wait-port80",
            "60",
            "--extra-domains",
            "a.example.org b.example.org",
            "--dns",
            "cloudflare",
            "--dns-credentials",
            "/tmp/cf.ini",
            "--deploy-hook",
            "systemctl reload nginx",
            "--auto-retry",
            "--retry-attempts",
            "20",
            "--retry-interval",
            "30",
            "--staging",
            "--force",
            "--backup-certs",
            "--lock",
            "--apply",
            "--yes",
        ]
    );
}

// The narrow scopes are verbs, not flags, so each one carries the same flags and
// differs only in the word that leads. This is what proves the payload actually
// reaches them: a projection that matched only Setup would emit an empty argv.
#[test]
fn every_setup_shaped_verb_forwards_its_flags() {
    for (verb, key) in [
        ("setup", crate::core::dispatch::DispatchKey::DomainSetup),
        ("cert", crate::core::dispatch::DispatchKey::DomainCert),
        ("proxy", crate::core::dispatch::DispatchKey::DomainProxy),
    ] {
        let (got_key, args) =
            parse(&["cms", "domain", verb, "--domain", "x.example.org"]).expect("resolves");
        assert_eq!(got_key, key);
        assert_eq!(
            args,
            vec![verb, "--domain", "x.example.org"],
            "{verb} forwards the same payload as setup"
        );
    }
}

#[test]
fn the_removed_scope_flags_are_never_emitted() {
    let (_, args) = parse(&["cms", "domain", "setup", "--apply"]).expect("resolves");
    for flag in ["--cert-only", "--proxy-only"] {
        assert!(!args.iter().any(|arg| arg == flag), "{flag} came back");
    }
}

// The script reads "unlimited" as attempts=0, so --retry-forever has to reach
// it as that sentinel. Emitting the bare flag would leave the default cap of 8.
#[test]
fn retry_forever_reaches_the_script_as_an_unlimited_attempt_cap() {
    let (_, args) = parse(&["cms", "domain", "setup", "--retry-forever"]).expect("resolves");
    assert!(args.contains(&"--auto-retry".to_string()));
    let attempts = args
        .windows(2)
        .find(|w| w[0] == "--retry-attempts")
        .expect("emits an attempt cap");
    assert_eq!(attempts[1], "0");
}

#[test]
fn check_expiry_forwards_the_day_threshold() {
    let (key, args) = parse(&["cms", "domain", "check-expiry", "--days", "30"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainCheckExpiry);
    assert_eq!(args, vec!["check-expiry", "--days", "30"]);
}

#[test]
fn revoke_forwards_the_reason() {
    let (key, args) =
        parse(&["cms", "domain", "revoke", "--reason", "keycompromise"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainRevoke);
    assert_eq!(args, vec!["revoke", "--reason", "keycompromise"]);
}
