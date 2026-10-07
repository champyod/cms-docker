//! Encoder assertions for `__domain.sh setup`, kept out of the encoder file so both
//! stay readable.

use super::{
    domain_setup_args, DomainRetryPolicy, DomainSetupRequest, DomainStorePolicy, DomainSwitches,
};

/// The baseline every caller starts from: `cms domain setup` with no flags.
fn base() -> DomainSetupRequest {
    DomainSetupRequest {
        cert: "letsencrypt".to_string(),
        is_yes: true,
        ..DomainSetupRequest::default()
    }
}

#[test]
fn an_empty_request_is_only_the_verb_cert_and_non_interactive_flag() {
    assert_eq!(
        domain_setup_args("setup", &base()),
        vec!["setup", "--cert", "letsencrypt", "--yes"]
    );
}

#[test]
fn a_blank_cert_falls_back_to_the_script_default() {
    let setup = DomainSetupRequest {
        cert: String::new(),
        ..base()
    };
    assert_eq!(
        domain_setup_args("setup", &setup),
        vec!["setup", "--cert", "letsencrypt", "--yes"]
    );
}

#[test]
fn every_value_flag_is_emitted_in_script_order() {
    let setup = DomainSetupRequest {
        domain: "contest.example.org".to_string(),
        admin_domain: "admin.example.org".to_string(),
        oj_domain: "oj.example.org".to_string(),
        ranking_domain: "rank.example.org".to_string(),
        cert_path: "/etc/certs/fullchain.pem".to_string(),
        key_path: "/etc/certs/privkey.pem".to_string(),
        email: "ops@example.org".to_string(),
        extra_domains: "a.example.org b.example.org".to_string(),
        dns: "cloudflare".to_string(),
        dns_credentials: "/etc/certs/dns.ini".to_string(),
        deploy_hook: "systemctl reload nginx".to_string(),
        ..base()
    };
    assert_eq!(
        domain_setup_args("setup", &setup),
        vec![
            "setup",
            "--cert",
            "letsencrypt",
            "--domain",
            "contest.example.org",
            "--admin-domain",
            "admin.example.org",
            "--oj-domain",
            "oj.example.org",
            "--ranking-domain",
            "rank.example.org",
            "--cert-path",
            "/etc/certs/fullchain.pem",
            "--key-path",
            "/etc/certs/privkey.pem",
            "--email",
            "ops@example.org",
            "--extra-domains",
            "a.example.org b.example.org",
            "--dns",
            "cloudflare",
            "--dns-credentials",
            "/etc/certs/dns.ini",
            "--deploy-hook",
            "systemctl reload nginx",
            "--yes",
        ]
    );
}

#[test]
fn an_empty_value_is_omitted_so_the_script_keeps_its_own_default() {
    let setup = DomainSetupRequest {
        domain: "contest.example.org".to_string(),
        admin_domain: String::new(),
        email: String::new(),
        ..base()
    };
    let args = domain_setup_args("setup", &setup);
    assert!(args.contains(&"--domain".to_string()));
    assert!(!args.contains(&"--admin-domain".to_string()));
    assert!(!args.contains(&"--email".to_string()));
}

#[test]
fn retry_forever_reaches_the_script_as_an_unlimited_attempt_cap() {
    let setup = DomainSetupRequest {
        retry: DomainRetryPolicy {
            is_retry_forever: true,
            attempts: Some(20),
            ..DomainRetryPolicy::default()
        },
        ..base()
    };
    let args = domain_setup_args("setup", &setup);
    assert!(args.contains(&"--auto-retry".to_string()));
    let attempts = args
        .windows(2)
        .find(|pair| pair[0] == "--retry-attempts")
        .expect("emits an attempt cap");
    assert_eq!(attempts[1], "0", "forever overrides a typed cap");
}

#[test]
fn auto_retry_alone_keeps_the_typed_cap() {
    let setup = DomainSetupRequest {
        retry: DomainRetryPolicy {
            is_auto_retry: true,
            attempts: Some(3),
            interval: Some(45),
            ..DomainRetryPolicy::default()
        },
        ..base()
    };
    assert_eq!(
        domain_setup_args("setup", &setup),
        vec![
            "setup",
            "--cert",
            "letsencrypt",
            "--auto-retry",
            "--retry-attempts",
            "3",
            "--retry-interval",
            "45",
            "--yes",
        ]
    );
}

#[test]
fn no_retry_related_argv_at_all_when_retry_is_off() {
    let setup = DomainSetupRequest {
        retry: DomainRetryPolicy::default(),
        ..base()
    };
    let args = domain_setup_args("setup", &setup);
    for flag in ["--auto-retry", "--retry-attempts", "--retry-interval"] {
        assert!(!args.iter().any(|arg| arg == flag), "{flag} leaked");
    }
}

#[test]
fn the_boolean_flags_keep_their_established_order() {
    let setup = DomainSetupRequest {
        switches: DomainSwitches {
            is_staging: true,
            is_force: true,
            is_lock: true,
        },
        store: DomainStorePolicy {
            is_backup_certs: true,
            is_auto_renew: true,
        },
        wait_port80: Some(60),
        ..base()
    };
    assert_eq!(
        domain_setup_args("setup", &setup),
        vec![
            "setup",
            "--cert",
            "letsencrypt",
            "--wait-port80",
            "60",
            "--staging",
            "--force",
            "--backup-certs",
            "--lock",
            "--auto-renew",
            "--yes",
        ]
    );
}

#[test]
fn apply_is_only_present_when_it_was_asked_for() {
    assert!(!domain_setup_args("setup", &base()).contains(&"--apply".to_string()));
    let live = DomainSetupRequest {
        is_apply: true,
        ..base()
    };
    assert!(domain_setup_args("setup", &live).contains(&"--apply".to_string()));
}

#[test]
fn the_verb_is_the_first_argument_and_alone_picks_the_scope() {
    // WHY this matters: `cert` and `proxy` are the two halves of `setup`, and the only
    // thing on the command line that distinguishes them is which word comes first. If
    // the encoder ever leaked a scope flag into argv, the script would reject it and the
    // operator would see a parser error instead of the scope they asked for.
    let setup = DomainSetupRequest {
        domain: "contest.example.org".to_string(),
        switches: DomainSwitches {
            is_staging: true,
            ..DomainSwitches::default()
        },
        ..base()
    };
    for verb in ["setup", "cert", "proxy"] {
        let args = domain_setup_args(verb, &setup);
        assert_eq!(args.first().map(String::as_str), Some(verb));
        assert!(
            !args.contains(&"--cert-only".to_string()),
            "flag was removed"
        );
        assert!(
            !args.contains(&"--proxy-only".to_string()),
            "flag was removed"
        );
    }
    // Both narrow scopes carry identical flags; the script decides which half to skip,
    // so the encoder must not try to second-guess it.
    assert_eq!(
        domain_setup_args("cert", &setup).len(),
        domain_setup_args("proxy", &setup).len()
    );
}
