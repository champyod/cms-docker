use super::{
    domain_setup_args, emitted_flag_names, DomainMode, DomainRetryPolicy, DomainSetupRequest,
    DomainSwitches, DEFAULT_CERT_METHOD,
};

fn request() -> DomainSetupRequest {
    DomainSetupRequest {
        cert: "provided".to_string(),
        domain: Some("a.example".to_string()),
        admin_domain: Some("adm.example".to_string()),
        oj_domain: Some("oj.example".to_string()),
        ranking_domain: Some("rank.example".to_string()),
        cert_path: Some("/c/fullchain.pem".to_string()),
        key_path: Some("/c/privkey.pem".to_string()),
        email: Some("ops@example".to_string()),
        extra_domains: Some("x.example y.example".to_string()),
        dns: Some("cloudflare".to_string()),
        dns_credentials: Some("/c/creds.ini".to_string()),
        deploy_hook: Some("systemctl reload nginx".to_string()),
        config: Some("/c/alt.env".to_string()),
        reason: Some("keycompromise".to_string()),
        days: Some(14),
        wait_port80: Some(45),
        retry: DomainRetryPolicy {
            is_auto_retry: true,
            is_retry_forever: true,
            attempts: Some(3),
            interval: Some(20),
        },
        switches: DomainSwitches {
            is_staging: true,
            is_force: true,
            is_backup_certs: true,
            is_lock: true,
            is_json: true,
        },
        mode: DomainMode {
            is_dry_run: true,
            is_apply: true,
            is_yes: true,
        },
    }
}

fn argv(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_string()).collect()
}

/// An empty request must still name a certificate method, because the script reads
/// `--cert` before anything else and rejects a verb it cannot scope.
#[test]
fn an_empty_request_still_sends_the_default_cert_method() {
    assert_eq!(
        domain_setup_args("setup", &DomainSetupRequest::default()),
        argv(&["setup", "--cert", DEFAULT_CERT_METHOD])
    );
}

#[test]
fn a_blank_cert_row_falls_back_to_the_script_default() {
    let setup = DomainSetupRequest {
        cert: "   ".to_string(),
        ..DomainSetupRequest::default()
    };
    let args = domain_setup_args("cert", &setup);
    assert_eq!(args[0], "cert");
    assert_eq!(args[1..3], argv(&["--cert", DEFAULT_CERT_METHOD])[..]);
}

#[test]
fn every_field_reaches_argv() {
    let args = domain_setup_args("setup", &request());
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
fn the_verb_travels_first_so_the_script_scopes_the_run_before_reading_flags() {
    for verb in ["setup", "cert", "proxy"] {
        assert_eq!(
            domain_setup_args(verb, &DomainSetupRequest::default())[0],
            verb
        );
    }
}

#[test]
fn unset_fields_are_omitted_so_the_script_keeps_applying_its_own_defaults() {
    let args = domain_setup_args("setup", &DomainSetupRequest::default());
    for absent in [
        "--domain", "--email", "--days", "--reason", "--dns", "--config", "--apply", "--json",
    ] {
        assert!(
            !args.iter().any(|arg| arg == absent),
            "{absent} was sent although it was never given"
        );
    }
}

/// The script resolves the mode pair in argv order, so emitting `--apply` first would
/// silently turn an operator's dry-run request into a live run.
#[test]
fn dry_run_precedes_apply_so_the_script_applies() {
    let args = domain_setup_args("setup", &request());
    let dry_run_at = args.iter().position(|arg| arg == "--dry-run");
    let apply_at = args.iter().position(|arg| arg == "--apply");
    assert!(
        dry_run_at < apply_at,
        "the script reads the pair in argv order"
    );
}

/// The flag set is the contract with `scripts/__domain.sh`'s parse block. A flag added
/// to the encoder and not to the script (or the reverse) is invisible to any test that
/// only builds argv, because such a test never reads the script's own `case` arms.
#[test]
fn the_emitted_flag_set_is_the_script_parse_block() {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../scripts/__domain.sh"
    ))
    .expect("the domain script is in the repo");
    // Only the parse block counts: the usage text above it documents the same flags
    // with their arguments (`--cert <letsencrypt|provided>`), which is prose, not a
    // pattern the script matches on.
    let parse_block = source
        .split("while [[ $# -gt 0 ]]; do")
        .nth(1)
        .and_then(|rest| rest.split("esac").next())
        .expect("the script still parses its flags in a while/case block");
    let script: Vec<&str> = parse_block
        .lines()
        // A parse arm is the pattern between the arm indentation and its `)`, so
        // `--yes|-y)` yields both spellings the script accepts.
        .filter(|line| line.trim_start().starts_with("--"))
        .filter_map(|line| line.split(')').next())
        .flat_map(|pattern| pattern.split('|'))
        .map(str::trim)
        .filter(|flag| flag.starts_with("--"))
        // `--help` is answered by the same loop but is not a value a run carries, so it is
        // deliberately absent from the form; the short spellings are aliases, not flags.
        .filter(|flag| *flag != "--help")
        .collect();
    let emitted = emitted_flag_names();
    for flag in &emitted {
        assert!(
            script.contains(flag),
            "{flag} is emitted but __domain.sh has no parse arm for it"
        );
    }
    for flag in &script {
        assert!(
            emitted.contains(flag),
            "__domain.sh parses {flag} but no form row can send it"
        );
    }
}
