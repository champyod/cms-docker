//! Prefill and argv assertions for the domain form.
//!
//! WHY the form is built over a scratch directory rather than mocked: `read_env_file`
//! and `read_toml` are the two functions that decide what the operator is shown, and a
//! hand-written fake would only prove the fake agrees with itself.

use super::{form_from_disk, read_seeded_values};
use crate::tui::pages::domain_request::{argv, request, wants_apply};
use crossterm::event::KeyCode;

/// A per-test directory that no other test shares, so seeds cannot bleed across tests.
fn scratch(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("cms_domain_{label}_{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

fn write(root: &std::path::Path, name: &str, body: &str) {
    std::fs::write(root.join(name), body).expect("seed file");
}

#[test]
fn an_untouched_form_on_an_empty_box_encodes_a_dry_run() {
    let form = form_from_disk(&scratch("bare"));
    assert!(!wants_apply(&form));
    assert_eq!(
        argv(&form),
        vec!["setup", "--cert", "letsencrypt", "--yes"],
        "an empty box must not produce --apply"
    );
}

#[test]
fn config_values_prefill_the_rows_that_read_them() {
    let root = scratch("cfg");
    write(
        &root,
        "config.toml",
        "[admin]\nDOMAIN_NAME = \"contest.example.org\"\nADMIN_DOMAIN = \"admin.example.org\"\n\
         LE_STAGING = 1\nCERT_RETRY_ATTEMPTS = 3\n",
    );
    let form = form_from_disk(&root);
    assert_eq!(form.value_of("--domain"), "contest.example.org");
    assert_eq!(form.value_of("--admin-domain"), "admin.example.org");
    assert!(
        form.is_on("--staging"),
        "LE_STAGING=1 shows as a checked box"
    );
    assert_eq!(form.number_of("--retry-attempts"), Some(3));
}

#[test]
fn a_contest_section_value_prefills_the_oj_row() {
    let root = scratch("contest");
    write(
        &root,
        "config.toml",
        "[contest]\nCONTEST_DOMAIN = \"oj.example.org\"\n",
    );
    assert_eq!(
        form_from_disk(&root).value_of("--oj-domain"),
        "oj.example.org",
        "CONTEST_DOMAIN is configured under [contest], not [admin]"
    );
}

#[test]
fn env_values_prefill_the_rows_that_read_them() {
    let root = scratch("env");
    write(
        &root,
        ".env",
        "ACME_DNS_PROVIDER=cloudflare\nWAIT_PORT80_TIMEOUT=45\nUSE_LOCK=1\n",
    );
    let form = form_from_disk(&root);
    assert_eq!(form.value_of("--dns"), "cloudflare");
    assert_eq!(form.number_of("--wait-port80"), Some(45));
    assert!(form.is_on("--lock"));
}

#[test]
fn env_wins_over_config_toml_because_the_script_sources_it_first() {
    let root = scratch("both");
    write(
        &root,
        "config.toml",
        "[admin]\nDOMAIN_NAME = \"from-config.example.org\"\n",
    );
    write(&root, ".env", "DOMAIN_NAME=from-env.example.org\n");
    assert_eq!(
        form_from_disk(&root).value_of("--domain"),
        "from-env.example.org"
    );
}

#[test]
fn an_unparseable_config_leaves_the_form_usable() {
    let root = scratch("bad-toml");
    write(&root, "config.toml", "this is = = not toml\n");
    let form = form_from_disk(&root);
    assert_eq!(form.value_of("--domain"), "");
    assert!(!wants_apply(&form));
}

#[test]
fn a_missing_repo_root_reads_as_nothing_configured() {
    let missing = scratch("missing-root").join("not-a-directory");
    let seeded = read_seeded_values(&missing);
    assert_eq!(seeded.lookup("DOMAIN_NAME"), "");
}

#[test]
fn an_unknown_cert_method_is_not_seeded_into_the_form() {
    let root = scratch("bad-cert");
    write(
        &root,
        "config.toml",
        "[admin]\nDOMAIN_CERT_METHOD = \"wildcard\"\n",
    );
    assert_eq!(form_from_disk(&root).value_of("--cert"), "letsencrypt");
}

#[test]
fn editing_a_domain_reaches_the_argv() {
    let root = scratch("edit");
    let mut form = form_from_disk(&root);
    form.goto_row("--domain");
    for ch in "contest.example.org".chars() {
        form.handle_key(KeyCode::Char(ch));
    }
    assert_eq!(
        argv(&form),
        vec![
            "setup",
            "--cert",
            "letsencrypt",
            "--domain",
            "contest.example.org",
            "--yes"
        ]
    );
}

#[test]
fn toggling_every_advanced_flag_reaches_the_argv() {
    let root = scratch("flags");
    let mut form = form_from_disk(&root);
    for label in [
        "--auto-retry",
        "--retry-forever",
        "--staging",
        "--force",
        "--backup-certs",
        "--lock",
    ] {
        form.goto_row(label);
        form.handle_key(KeyCode::Char(' '));
        assert!(form.is_on(label), "{label} did not toggle");
    }
    let args = argv(&form);
    assert!(args.contains(&"--auto-retry".to_string()));
    assert!(args.contains(&"--staging".to_string()));
    assert!(args.contains(&"--force".to_string()));
    assert!(args.contains(&"--backup-certs".to_string()));
    assert!(args.contains(&"--lock".to_string()));
    assert_eq!(
        args.windows(2)
            .find(|pair| pair[0] == "--retry-attempts")
            .map(|pair| pair[1].clone()),
        Some("0".to_string()),
        "retry-forever must reach the script as the unlimited sentinel"
    );
}

#[test]
fn apply_is_the_only_thing_that_adds_the_live_run_flag() {
    let root = scratch("apply");
    let mut form = form_from_disk(&root);
    assert!(!argv(&form).contains(&"--apply".to_string()));
    form.goto_row("--apply");
    form.handle_key(KeyCode::Char(' '));
    assert!(wants_apply(&form));
    assert!(argv(&form).contains(&"--apply".to_string()));
}

#[test]
fn a_blank_counter_is_omitted_rather_than_sent_as_zero() {
    let root = scratch("blank");
    let mut form = form_from_disk(&root);
    form.goto_row("--wait-port80");
    for _ in 0..4 {
        form.handle_key(KeyCode::Backspace);
    }
    assert_eq!(form.value_of("--wait-port80"), "");
    assert_eq!(request(&form).wait_port80, None);
    assert!(!argv(&form).contains(&"--wait-port80".to_string()));
}

#[test]
fn a_typed_counter_is_sent_as_the_operator_named_it() {
    let root = scratch("counter");
    let mut form = form_from_disk(&root);
    form.goto_row("--wait-port80");
    for _ in 0..4 {
        form.handle_key(KeyCode::Backspace);
    }
    for ch in "90".chars() {
        form.handle_key(KeyCode::Char(ch));
    }
    assert_eq!(request(&form).wait_port80, Some(90));
}

#[test]
fn an_integer_row_refuses_a_letter_before_it_can_reach_argv() {
    let root = scratch("refuse");
    let mut form = form_from_disk(&root);
    form.goto_row("--wait-port80");
    form.handle_key(KeyCode::Char('x'));
    assert_eq!(form.value_of("--wait-port80"), "");
    assert!(form.notice_of("--wait-port80").is_some());
}
