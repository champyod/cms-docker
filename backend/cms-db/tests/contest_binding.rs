//! The override's three values, the bootstrap variable, and the refusals' text.

use std::ffi::OsString;
use std::sync::{Mutex, PoisonError};

use cms_db::{bootstrap_contest_id, BindingError, ContestOverride, CONTEST_ID_ENV, NO_OVERRIDE};

/// The environment is process-wide, so every test that writes it holds this.
static ENVIRONMENT: Mutex<()> = Mutex::new(());

struct ContestIdVariable(Option<OsString>);

impl ContestIdVariable {
    fn set(value: Option<&str>) -> Self {
        let previous = std::env::var_os(CONTEST_ID_ENV);
        match value {
            Some(value) => std::env::set_var(CONTEST_ID_ENV, value),
            None => std::env::remove_var(CONTEST_ID_ENV),
        }
        Self(previous)
    }
}

impl Drop for ContestIdVariable {
    fn drop(&mut self) {
        match self.0.take() {
            Some(previous) => std::env::set_var(CONTEST_ID_ENV, previous),
            None => std::env::remove_var(CONTEST_ID_ENV),
        }
    }
}

fn environment() -> std::sync::MutexGuard<'static, ()> {
    ENVIRONMENT.lock().unwrap_or_else(PoisonError::into_inner)
}

#[test]
fn an_absent_override_is_its_own_value() {
    assert_eq!(NO_OVERRIDE, ContestOverride::Registry);
    assert_ne!(NO_OVERRIDE, ContestOverride::EveryContest);
    assert_ne!(NO_OVERRIDE, ContestOverride::Contest(8));
}

#[test]
fn the_bootstrap_reads_contest_id() {
    let _guard = environment();
    let _variable = ContestIdVariable::set(Some("42"));
    assert_eq!(bootstrap_contest_id().expect("a numeric id"), 42);
}

#[test]
fn an_unset_bootstrap_variable_is_refused() {
    let _guard = environment();
    let _variable = ContestIdVariable::set(None);
    assert!(matches!(
        bootstrap_contest_id(),
        Err(BindingError::BootstrapUnset)
    ));
}

#[test]
fn an_empty_bootstrap_variable_counts_as_unset() {
    let _guard = environment();
    let _variable = ContestIdVariable::set(Some(""));
    assert!(matches!(
        bootstrap_contest_id(),
        Err(BindingError::BootstrapUnset)
    ));
}

#[test]
fn a_bootstrap_value_that_is_not_an_id_is_refused_with_it() {
    let _guard = environment();
    let _variable = ContestIdVariable::set(Some("contest-eight"));
    match bootstrap_contest_id() {
        Err(BindingError::BootstrapNotAContest(value)) => assert_eq!(value, "contest-eight"),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn the_refusals_name_the_state_and_the_way_out() {
    assert!(BindingError::NoActiveContest
        .to_string()
        .contains("set-active"));
    let single = BindingError::EveryContestOnSingleContestService {
        role: "ProxyService".to_owned(),
        shard: 2,
    }
    .to_string();
    assert!(single.contains("ProxyService"));
    assert!(single.contains("shard 2"));
    assert!(single.contains("-c <contest_id>"));
    assert!(BindingError::MissingContests
        .to_string()
        .contains("does not exist yet"));
}
