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

// Why these four exist together: `renew` was payload-free, so every flag below used to
// fail with `unexpected argument`, and `cmd_renew` returns on its dry-run line before
// touching the store — a `renew` with no `--apply` could never have renewed anything.
#[test]
fn renew_forwards_due_and_apply() {
    let (key, args) = parse(&["cms", "domain", "renew", "--due", "--apply"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainRenew);
    assert_eq!(args, vec!["renew", "--due", "--apply"]);
}

#[test]
fn renew_without_flags_is_only_the_verb() {
    let (key, args) = parse(&["cms", "domain", "renew"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainRenew);
    assert_eq!(args, vec!["renew"]);
}

// `--lock` is the flag the run-lock comment on `_acquire_run_lock` is written for, and it
// was unreachable from the CLI because `renew` accepted no flags at all.
#[test]
fn renew_forwards_the_run_lock_flag() {
    let (_, args) = parse(&["cms", "domain", "renew", "--lock"]).expect("resolves");
    assert_eq!(args, vec!["renew", "--lock"]);
}

#[test]
fn renew_forwards_every_flag_the_script_parses() {
    let (key, args) = parse(&[
        "cms",
        "domain",
        "renew",
        "--cert",
        "letsencrypt",
        "--domain",
        "grader.example.org",
        "--admin-domain",
        "admin.example.org",
        "--oj-domain",
        "oj.example.org",
        "--ranking-domain",
        "rank.example.org",
        "--email",
        "ops@example.org",
        "--challenge",
        "tls-alpn-01",
        "--ca",
        "zerossl",
        "--acme-server",
        "https://acme.example.org/directory",
        "--acme-client",
        "lego",
        "--tls-address",
        "0.0.0.0:443",
        "--dns",
        "cloudflare",
        "--dns-credentials",
        "/tmp/cf.ini",
        "--extra-domains",
        "a.example.org",
        "--wait-port80",
        "60",
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
        "--due",
        "--apply",
    ])
    .expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainRenew);
    assert_eq!(
        args,
        vec![
            "renew",
            "--cert",
            "letsencrypt",
            "--domain",
            "grader.example.org",
            "--admin-domain",
            "admin.example.org",
            "--oj-domain",
            "oj.example.org",
            "--ranking-domain",
            "rank.example.org",
            "--email",
            "ops@example.org",
            "--wait-port80",
            "60",
            "--extra-domains",
            "a.example.org",
            "--dns",
            "cloudflare",
            "--dns-credentials",
            "/tmp/cf.ini",
            "--challenge",
            "tls-alpn-01",
            "--ca",
            "zerossl",
            "--acme-server",
            "https://acme.example.org/directory",
            "--acme-client",
            "lego",
            "--tls-address",
            "0.0.0.0:443",
            "--deploy-hook",
            "systemctl reload nginx",
            "--auto-retry",
            "--retry-attempts",
            "20",
            "--retry-interval",
            "30",
            "--due",
            "--staging",
            "--force",
            "--backup-certs",
            "--lock",
            "--apply",
        ]
    );
}

#[test]
fn renew_reaches_the_script_as_an_unlimited_attempt_cap_for_retry_forever() {
    let (_, args) = parse(&["cms", "domain", "renew", "--retry-forever"]).expect("resolves");
    assert!(args.contains(&"--auto-retry".to_string()));
    let attempts = args
        .windows(2)
        .find(|w| w[0] == "--retry-attempts")
        .expect("emits an attempt cap");
    assert_eq!(attempts[1], "0");
}

#[test]
fn status_forwards_json() {
    let (key, args) = parse(&["cms", "domain", "status", "--json"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainStatus);
    assert_eq!(args, vec!["status", "--json"]);
}

#[test]
fn status_without_json_keeps_its_original_shape() {
    let (key, args) = parse(&["cms", "domain", "status"]).expect("resolves");
    assert_eq!(key, crate::core::dispatch::DispatchKey::DomainStatus);
    assert_eq!(args, vec!["status"]);
}

// The scope is the verb on this side too. A renew that could name `--cert-only` would
// be asking `cmd_renew` to skip nginx, which it never does and has no flag for.
#[test]
fn renew_cannot_name_a_setup_scope() {
    for flag in ["--cert-only", "--proxy-only"] {
        let parsed =
            <crate::Args as clap::Parser>::try_parse_from(["cms", "domain", "renew", flag]);
        assert!(
            parsed.is_err(),
            "renew accepted {flag}, which no renew path can honour"
        );
    }
    let (_, args) = parse(&["cms", "domain", "renew", "--due", "--apply"]).expect("resolves");
    for flag in ["--cert-only", "--proxy-only", "--install-timer"] {
        assert!(!args.iter().any(|arg| arg == flag), "{flag} came back");
    }
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

// Both verbs reach the same key because the operator types the flag where they already
// are; there is no separate `domain install-timer` verb to remember instead.
#[test]
fn install_timer_reaches_the_timer_key_from_either_verb() {
    for verb in ["setup", "renew"] {
        let (key, args) = parse(&["cms", "domain", verb, "--install-timer"]).expect("resolves");
        assert_eq!(
            key,
            crate::core::dispatch::DispatchKey::DomainCertTimerInstall,
            "{verb} --install-timer installs the timer"
        );
        assert!(args.is_empty(), "{verb} forwarded {args:?} to the script");
    }
}

// The script has no --install-timer option, so emitting it would end in
// `unknown option: --install-timer` rather than an install.
#[test]
fn install_timer_is_never_forwarded_to_the_domain_script() {
    for verb in ["setup", "renew"] {
        let (_, args) = parse(&["cms", "domain", verb, "--install-timer"]).expect("resolves");
        assert!(
            !args.iter().any(|arg| arg == "--install-timer"),
            "{verb} leaked the flag into the script argv: {args:?}"
        );
    }
}

// The install replaces the verb rather than joining it: `renew` is dry-run by default,
// and writing systemd units inside a dry run would contradict the flag.
#[test]
fn install_timer_short_circuits_the_verb_it_was_typed_after() {
    let (key, args) = parse(&["cms", "domain", "renew", "--install-timer"]).expect("resolves");
    assert_eq!(
        key,
        crate::core::dispatch::DispatchKey::DomainCertTimerInstall
    );
    assert!(
        !args.contains(&"renew".to_string()),
        "renew still ran alongside the install: {args:?}"
    );
}

// A setup payload typed with the flag must not leak into the install either — the argv
// is empty, so none of the domain flags can ride along.
#[test]
fn install_timer_ignores_the_setup_payload_typed_next_to_it() {
    let (key, args) = parse(&[
        "cms",
        "domain",
        "setup",
        "--install-timer",
        "--domain",
        "grader.example.org",
        "--apply",
    ])
    .expect("resolves");
    assert_eq!(
        key,
        crate::core::dispatch::DispatchKey::DomainCertTimerInstall
    );
    assert!(
        args.is_empty(),
        "setup flags rode along with the install: {args:?}"
    );
}

// The renew payload grew after the timer flag was added, so the short-circuit has to
// still be checked before argv is built — otherwise `renew --install-timer --apply`
// would start installing units and renewing in the same run.
#[test]
fn install_timer_ignores_the_renew_payload_typed_next_to_it() {
    let (key, args) = parse(&[
        "cms",
        "domain",
        "renew",
        "--install-timer",
        "--due",
        "--apply",
    ])
    .expect("resolves");
    assert_eq!(
        key,
        crate::core::dispatch::DispatchKey::DomainCertTimerInstall
    );
    assert!(
        args.is_empty(),
        "renew flags rode along with the install: {args:?}"
    );
}
