use super::{DomainAction, DomainView};
use crate::tui::components::config_form::ConfigForm;
use crate::tui::pages::{domain_fields, domain_request};
use clap::Parser;
use domain_fields::APPLY_LABEL;
use ratatui::crossterm::event::KeyCode;

fn view() -> DomainView {
    DomainView::from_values("setup", &[])
}

/// A stand-in for the command-line entry point, so the test drives clap's own parser
/// instead of hand-building the flags struct the parser would have produced.
#[derive(clap::Parser)]
struct TestCli {
    #[command(subcommand)]
    command: crate::cli::Commands,
}

fn typed(view: &mut DomainView, label: &str, keys: &str) {
    view.form_mut().focus_row(label);
    for key in keys.chars() {
        view.form_mut().handle_key(KeyCode::Char(key));
    }
}

#[test]
fn the_form_carries_every_row_the_table_declares() {
    let view = view();
    let labels = view.form().labels();
    for spec in domain_fields::all_specs() {
        assert!(
            labels.iter().any(|label| label == spec.label),
            "the form has no {} row",
            spec.label
        );
    }
}

#[test]
/// The page shows its own state as prose, so an operator can see whether a run is live
/// without reading the argv.
fn a_fresh_form_describes_a_dry_run_not_a_live_one() {
    let view = view();
    assert!(!view.is_apply(), "the form opened armed");
    assert!(!view.is_arming());
    assert!(
        !view.preview().contains("--apply"),
        "a fresh form sent --apply: {}",
        view.preview()
    );
    assert!(
        view.preview().contains("--yes"),
        "the form must answer the script's prompts: {}",
        view.preview()
    );
}

#[test]
fn the_preview_names_the_verb_the_script_reads_first() {
    let view = view();
    assert!(
        view.preview().starts_with("setup "),
        "{} does not lead with the verb",
        view.preview()
    );
    assert_eq!(view.verb(), "setup");
}

#[test]
fn the_cert_and_proxy_forms_submit_their_own_verb() {
    for verb in ["cert", "proxy"] {
        let view = DomainView::from_values(verb, &[]);
        assert!(view.preview().starts_with(verb), "{}", view.preview());
    }
}

/// Arming must take two deliberate keys, so a stray keystroke cannot reissue a certificate.
#[test]
fn a_live_run_needs_a_second_key_to_confirm() {
    let mut view = view();
    view.form_mut().focus_row(APPLY_LABEL);
    assert_eq!(view.handle_key(KeyCode::Char('a')), DomainAction::Arming);
    assert!(view.is_arming());
    assert!(
        !view.is_apply(),
        "arming asked the question, not the answer"
    );

    assert_eq!(view.handle_key(KeyCode::Char('y')), DomainAction::Confirmed);
    assert!(view.is_apply());
    assert!(!view.is_arming());
    assert!(
        view.preview().contains("--apply"),
        "an armed run did not send --apply: {}",
        view.preview()
    );
}

#[test]
fn any_other_key_cancels_the_live_run_question() {
    for key in [KeyCode::Char('n'), KeyCode::Esc, KeyCode::Enter] {
        let mut view = view();
        view.form_mut().focus_row(APPLY_LABEL);
        view.handle_key(KeyCode::Char('a'));
        assert_eq!(view.handle_key(key), DomainAction::Cancelled);
        assert!(!view.is_apply(), "{key:?} armed the run anyway");
        assert!(!view.is_arming());
    }
}

#[path = "domain_submit_tests.rs"]
mod submit;

#[test]
fn a_run_records_the_argv_it_launched() {
    let mut view = view();
    let launched = super::super::domain_request::argv(view.form(), "setup");
    view.note_run(launched.clone());
    assert_eq!(view.last_run(), launched.as_slice());
}

/// The whole point of the shared builder: what the form encodes and what the command line
/// encodes for the same values must be the same argv.
#[test]
fn the_form_and_the_command_line_encode_the_same_argv() {
    let mut view = view();
    typed(&mut view, "--domain", "a.example");
    typed(&mut view, "--email", "ops@example");
    view.form_mut().focus_row("--staging");
    view.form_mut().flip_row("--staging");

    // The form always sends `--yes` because it cannot answer the script's prompts; the
    // command line only sends it when asked. That is the one intended difference, so it
    // is asserted here rather than papered over.
    let cli = TestCli::parse_from([
        "cms",
        "domain",
        "setup",
        "--domain",
        "a.example",
        "--email",
        "ops@example",
        "--staging",
        "--yes",
    ]);
    let crate::cli::Commands::Domain {
        sub: crate::cli::DomainCmd::Setup { flags },
    } = cli.command
    else {
        panic!("setup parsed as a domain setup");
    };

    // The command-line argv comes from clap's flags through the CLI projection; the form's
    // comes from its rows through the TUI projection. Only the encoder is shared.
    let from_cli = crate::cli::resolve_domain_setup_args(&flags);
    let from_form = domain_request::argv(view.form(), "setup");
    assert_eq!(from_form, from_cli);
    assert!(
        from_form.contains(&"--staging".to_string()),
        "the toggled row is missing from the argv: {from_form:?}"
    );
    assert_eq!(flags.domain.as_deref(), Some("a.example"));
}

#[test]
fn an_untouched_counter_row_is_not_sent_as_zero() {
    let view = view();
    let plan = view.preview();
    for absent in ["--retry-attempts", "--retry-interval", "--wait-port80"] {
        assert!(
            !plan.contains(absent),
            "{absent} was sent although its row was left blank"
        );
    }
}

#[test]
fn the_form_never_sends_the_flag_only_for_revocation() {
    let mut view = view();
    typed(&mut view, "--domain", "a.example");
    let request = super::submit_request(&view);
    assert!(
        request.reason.is_none() && request.days.is_none(),
        "the setup form must not carry revoke or check-expiry values"
    );
}

#[test]
fn escape_leaves_the_page_and_typing_keys_do_not() {
    let mut view = view();
    view.form_mut().focus_row("--domain");
    assert_eq!(view.handle_key(KeyCode::Esc), DomainAction::Back);
    assert_eq!(
        view.handle_key(KeyCode::Char('x')),
        DomainAction::Edited,
        "a typed character must not be read as a page binding"
    );
}

#[test]
fn an_empty_form_still_answers_every_key_without_panicking() {
    let mut view = DomainView::new("setup", ConfigForm::new(Vec::new()));
    assert_eq!(view.handle_key(KeyCode::Char('r')), DomainAction::Submit);
    assert_eq!(view.handle_key(KeyCode::Esc), DomainAction::Back);
    assert_eq!(view.handle_key(KeyCode::Down), DomainAction::Edited);
}
