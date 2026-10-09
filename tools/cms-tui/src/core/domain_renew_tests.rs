//! Encoder assertions for `__domain.sh renew`, kept out of the encoder file so both
//! stay readable.

use super::{domain_renew_args, DomainRenewRequest};
use crate::core::domain_setup::{DomainRetryPolicy, DomainSwitches};

/// The baseline every caller starts from: `cms domain renew` with no flags.
fn base() -> DomainRenewRequest {
    DomainRenewRequest::default()
}

#[test]
fn an_empty_request_is_only_the_verb() {
    assert_eq!(domain_renew_args(&base()), vec!["renew"]);
}

// WHY this one request is filled with every field it has: exact-argv equality over a
// maximal request pins the order AND proves the renew path cannot carry a setup flag,
// because any flag outside the list would break the equality. The scope is the verb on
// this side too, and `cmd_renew` calls neither installer, so those four would be parsed
// by the script and then ignored.
#[test]
fn a_fully_specified_request_emits_every_value_flag_in_script_order_and_nothing_else() {
    let renew = DomainRenewRequest {
        cert: "letsencrypt".to_string(),
        domain: "contest.example.org".to_string(),
        admin_domain: "admin.example.org".to_string(),
        oj_domain: "oj.example.org".to_string(),
        ranking_domain: "rank.example.org".to_string(),
        email: "ops@example.org".to_string(),
        wait_port80: Some(60),
        extra_domains: "a.example.org b.example.org".to_string(),
        dns: "cloudflare".to_string(),
        dns_credentials: "/etc/certs/dns.ini".to_string(),
        challenge: "tls-alpn-01".to_string(),
        ca: "zerossl".to_string(),
        acme_server: "https://acme.example.org/directory".to_string(),
        acme_client: "lego".to_string(),
        tls_address: "0.0.0.0:443".to_string(),
        deploy_hook: "systemctl reload nginx".to_string(),
        is_due: true,
        is_apply: true,
        is_backup_certs: true,
        switches: DomainSwitches {
            is_staging: true,
            is_force: true,
            is_lock: true,
        },
        retry: DomainRetryPolicy {
            is_auto_retry: true,
            attempts: Some(5),
            interval: Some(10),
            is_retry_forever: false,
        },
    };
    let args = domain_renew_args(&renew);
    assert_eq!(
        args,
        vec![
            "renew",
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
            "--email",
            "ops@example.org",
            "--wait-port80",
            "60",
            "--extra-domains",
            "a.example.org b.example.org",
            "--dns",
            "cloudflare",
            "--dns-credentials",
            "/etc/certs/dns.ini",
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
            "5",
            "--retry-interval",
            "10",
            "--due",
            "--staging",
            "--force",
            "--backup-certs",
            "--lock",
            "--apply",
        ]
    );
    for forbidden in [
        "--cert-only",
        "--proxy-only",
        "--cert-path",
        "--key-path",
        "--auto-renew",
        "--install-timer",
    ] {
        assert!(
            !args.iter().any(|arg| arg == forbidden),
            "{forbidden} leaked"
        );
    }
}

#[test]
fn an_empty_value_is_omitted_so_the_script_keeps_its_own_default() {
    let renew = DomainRenewRequest {
        domain: "contest.example.org".to_string(),
        admin_domain: String::new(),
        email: String::new(),
        ..base()
    };
    let args = domain_renew_args(&renew);
    assert!(args.contains(&"--domain".to_string()));
    assert!(!args.contains(&"--admin-domain".to_string()));
    assert!(!args.contains(&"--email".to_string()));
}

#[test]
fn an_empty_cert_is_left_to_the_script() {
    let typed = DomainRenewRequest {
        cert: "provided".to_string(),
        ..base()
    };
    assert_eq!(
        domain_renew_args(&typed),
        vec!["renew", "--cert", "provided"]
    );
    assert_eq!(domain_renew_args(&base()), vec!["renew"]);
}

// The script reads "unlimited" as attempts=0, so a bare --retry-forever would leave the
// default cap of 8 in force.
#[test]
fn retry_forever_reaches_the_script_as_an_unlimited_attempt_cap() {
    let renew = DomainRenewRequest {
        retry: DomainRetryPolicy {
            is_retry_forever: true,
            attempts: Some(20),
            ..DomainRetryPolicy::default()
        },
        ..base()
    };
    let args = domain_renew_args(&renew);
    assert!(args.contains(&"--auto-retry".to_string()));
    let attempts = args
        .windows(2)
        .find(|pair| pair[0] == "--retry-attempts")
        .expect("emits an attempt cap");
    assert_eq!(attempts[1], "0", "forever overrides a typed cap");
}

#[test]
fn auto_retry_alone_keeps_the_typed_cap() {
    let renew = DomainRenewRequest {
        retry: DomainRetryPolicy {
            is_auto_retry: true,
            attempts: Some(3),
            interval: Some(45),
            ..DomainRetryPolicy::default()
        },
        ..base()
    };
    assert_eq!(
        domain_renew_args(&renew),
        vec![
            "renew",
            "--auto-retry",
            "--retry-attempts",
            "3",
            "--retry-interval",
            "45",
        ]
    );
}

#[test]
fn no_retry_related_argv_at_all_when_retry_is_off() {
    let args = domain_renew_args(&base());
    for flag in ["--auto-retry", "--retry-attempts", "--retry-interval"] {
        assert!(!args.iter().any(|arg| arg == flag), "{flag} leaked");
    }
}

// WHY this order is pinned: `--due` decides what gets renewed at all, and the run
// switches behind it decide how. `--apply` trails them because it is what turns the
// whole line from a preview into a renewal.
#[test]
fn the_boolean_flags_keep_their_established_order() {
    let renew = DomainRenewRequest {
        switches: DomainSwitches {
            is_staging: true,
            is_force: true,
            is_lock: true,
        },
        is_due: true,
        is_apply: true,
        is_backup_certs: true,
        ..base()
    };
    assert_eq!(
        domain_renew_args(&renew),
        vec![
            "renew",
            "--due",
            "--staging",
            "--force",
            "--backup-certs",
            "--lock",
            "--apply",
        ]
    );
}

// WHY this is the defect the step exists for: `cmd_renew` returns on its dry-run line
// before touching the certificate store, so `--due` without `--apply` renews nothing.
#[test]
fn due_and_apply_are_both_carried_when_a_scheduler_asks_for_a_live_run() {
    let renew = DomainRenewRequest {
        is_due: true,
        is_apply: true,
        ..base()
    };
    assert_eq!(domain_renew_args(&renew), vec!["renew", "--due", "--apply"]);
}

#[test]
fn apply_is_only_present_when_it_was_asked_for() {
    assert!(!domain_renew_args(&base()).contains(&"--apply".to_string()));
    let live = DomainRenewRequest {
        is_apply: true,
        ..base()
    };
    assert!(domain_renew_args(&live).contains(&"--apply".to_string()));
}
