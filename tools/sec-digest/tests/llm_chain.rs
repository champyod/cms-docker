//! The model chain end to end: real subprocesses, real rejection, real fallback.
//! SEC_DIGEST_CHAIN is process-global, so every test holds CHAIN_ENV per case.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sec_digest::llm;
use sec_digest::record::RunRecord;

const FIXTURES: &str = "tests/fixtures";
const GOOD_BRIEF: &str = "## ACT NOW
**CVE-2026-7001** · linux, openssl · CRITICAL 10.0 · **exploited in the wild** · new
  OpenSSL buffer overread in the TLS handshake path
  <https://nvd.nist.gov/vuln/detail/CVE-2026-7001>
## WATCH
nothing new
## INDUSTRY
nothing new
## NEWS
nothing new
## TODAY FOR YOU
window 26h · 7 advisories read, 3 touch your stack; every feed answered.";

static CHAIN_ENV: Mutex<()> = Mutex::new(());

fn record() -> RunRecord {
    let text = fs::read_to_string(format!("{FIXTURES}/payload.json")).expect("payload fixture");
    serde_json::from_str(&text).expect("payload parses as a run record")
}

fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, body).expect("script body");
    let mut perms = fs::metadata(&path).expect("script metadata").permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&path, perms).expect("script mode");
    path
}

fn chain_file(dir: &Path, slots: serde_json::Value) -> PathBuf {
    let path = dir.join("chain.json");
    let body = serde_json::json!({ "slots": slots }).to_string();
    fs::write(&path, body).expect("chain file");
    path
}

/// Run one case with the chain env pointed at `chain`, serialised against the rest.
fn with_chain<T>(chain: &Path, case: impl FnOnce(&Path) -> T, state: &Path) -> T {
    let _guard = CHAIN_ENV.lock().unwrap_or_else(|poison| poison.into_inner());
    std::env::set_var("SEC_DIGEST_CHAIN", chain);
    case(state)
}

#[test]
fn a_failing_slot_names_its_reason_and_the_next_is_tried() {
    let dir = scratch("llm-failing");
    let broken = script(
        &dir,
        "broken",
        "#!/bin/sh\necho 'Error: Go usage limit exceeded' >&2\nexit 7\n",
    );
    let chain = chain_file(
        &dir,
        serde_json::json!([
            {"label": "broken/one", "cmd": [broken.to_string_lossy(), "-p", "{prompt}"], "timeout": 10},
            {"label": "broken/two", "cmd": ["definitely-not-a-real-binary-xyz", "{prompt}"], "timeout": 10}
        ]),
    );
    let state = dir.join("state");
    let outcome = with_chain(&chain, |state| llm::write_brief(&record(), state), &state);
    assert!(outcome.text.is_empty(), "no slot was usable");
    assert_eq!(outcome.model, "none");
    assert_eq!(outcome.reasons.len(), 2, "{:?}", outcome.reasons);
    assert!(outcome.reasons[0].contains("broken/one: exit 7"), "{:?}", outcome.reasons);
    assert!(outcome.reasons[0].contains("Go usage limit exceeded"), "{:?}", outcome.reasons);
    assert!(outcome.reasons[1].contains("not found"), "{:?}", outcome.reasons);
    let saved = fs::read_to_string(state.join("last_llm_reasons.json")).expect("reasons file");
    assert!(saved.contains("Go usage limit exceeded"), "{saved}");
}

#[test]
fn an_invented_cve_is_rejected_and_never_returned() {
    let dir = scratch("llm-liar");
    let liar = script(
        &dir,
        "liar",
        "#!/bin/sh\ncat <<'EOF'\n## ACT NOW\n**CVE-2099-99999** · linux · CRITICAL 10.0 · **exploited in the wild**\n  This id was not in the input and must never reach the brief\n  <https://nvd.nist.gov/vuln/detail/CVE-2099-99999>\n## WATCH\nnothing new\n## INDUSTRY\nnothing new\n## NEWS\nnothing new\n## TODAY FOR YOU\nwindow 26h · 7 advisories read, 3 touch your stack.\nEOF\n",
    );
    let chain = chain_file(
        &dir,
        serde_json::json!([
            {"label": "liar/slot", "cmd": [liar.to_string_lossy(), "-p", "{prompt}"], "timeout": 10}
        ]),
    );
    let state = dir.join("state");
    let outcome = with_chain(&chain, |state| llm::write_brief(&record(), state), &state);
    assert!(outcome.text.is_empty(), "rejected text must not be returned");
    assert_eq!(outcome.model, "none");
    assert_eq!(outcome.reasons.len(), 1, "{:?}", outcome.reasons);
    assert!(outcome.reasons[0].contains("rejected (invented ids:"), "{:?}", outcome.reasons);
    assert!(outcome.reasons[0].contains("CVE-2099-99999"), "{:?}", outcome.reasons);
}

#[test]
fn the_first_usable_answer_wins_and_names_its_slot() {
    let dir = scratch("llm-winner");
    let liar = script(
        &dir,
        "liar",
        "#!/bin/sh\necho '## ACT NOW'\necho '**CVE-2099-88888** invented advisory text that is long enough to pass the length floor without any trouble at all, and then some more words to be safe.'\n",
    );
    let good = script(
        &dir,
        "good",
        &format!("#!/bin/sh\necho 'Update available: 1.2.3'\ncat <<'EOF'\n{GOOD_BRIEF}\nEOF\n"),
    );
    let never = script(&dir, "never", "#!/bin/sh\ntouch \"$(dirname \"$0\")/ran-third\"\nexit 1\n");
    let chain = chain_file(
        &dir,
        serde_json::json!([
            {"label": "liar/slot", "cmd": [liar.to_string_lossy(), "{prompt}"], "timeout": 10},
            {"label": "good/slot", "cmd": [good.to_string_lossy(), "{prompt}"], "timeout": 10},
            {"label": "never/slot", "cmd": [never.to_string_lossy(), "{prompt}"], "timeout": 10}
        ]),
    );
    let state = dir.join("state");
    let outcome = with_chain(&chain, |state| llm::write_brief(&record(), state), &state);
    assert_eq!(outcome.text, GOOD_BRIEF, "the banner line must be cut");
    assert_eq!(outcome.model, "good/slot");
    assert_eq!(outcome.reasons.len(), 1, "{:?}", outcome.reasons);
    assert!(!dir.join("ran-third").exists(), "slots after the winner must not run");
}

#[test]
fn a_slot_that_hangs_is_a_timeout_not_a_wait_forever() {
    let dir = scratch("llm-slow");
    let slow = script(&dir, "slow", "#!/bin/sh\nsleep 30\n");
    let chain = chain_file(
        &dir,
        serde_json::json!([
            {"label": "slow/slot", "cmd": [slow.to_string_lossy(), "{prompt}"], "timeout": 1}
        ]),
    );
    let state = dir.join("state");
    let started = std::time::Instant::now();
    let outcome = with_chain(&chain, |state| llm::write_brief(&record(), state), &state);
    assert!(started.elapsed() < std::time::Duration::from_secs(10), "timeout was not enforced");
    assert!(outcome.text.is_empty());
    assert_eq!(outcome.reasons, vec!["slow/slot: timeout".to_string()]);
}

#[test]
fn an_unreadable_chain_is_a_reason_not_a_panic() {
    let dir = scratch("llm-nochain");
    let missing = dir.join("absent.json");
    let state = dir.join("state");
    let outcome = with_chain(&missing, |state| llm::write_brief(&record(), state), &state);
    assert!(outcome.text.is_empty());
    assert_eq!(outcome.model, "none");
    assert!(outcome.reasons[0].contains("chain unusable"), "{:?}", outcome.reasons);
    assert!(outcome.reasons[0].contains("absent.json"), "{:?}", outcome.reasons);
}

#[test]
fn the_guard_rejects_short_refusals_and_invented_ids() {
    let allowed: std::collections::BTreeSet<String> =
        ["CVE-2026-7001".to_string(), "USN-9002-1".to_string()].into_iter().collect();
    assert_eq!(llm::validate::check("too short", &allowed), Err("too short".to_string()));
    let refusal = "## ACT NOW\nI cannot help with that request. ".repeat(10);
    assert_eq!(llm::validate::check(&refusal, &allowed), Err("refusal".to_string()));
    let invented = format!("## ACT NOW\n{} CVE-2099-12345 follows. {}", GOOD_BRIEF, "pad ".repeat(60));
    let why = llm::validate::check(&invented, &allowed).expect_err("invented id");
    assert!(why.contains("invented ids: [CVE-2099-12345]"), "{why}");
    let lower = format!("{GOOD_BRIEF} cve-2026-7001 repeated in lower case.");
    assert_eq!(llm::validate::check(&lower, &allowed), Ok(()));
}

#[test]
fn a_bare_name_is_found_in_extra_bin_when_cron_path_is_bare() {
    let dir = scratch("llm-extra-bin");
    let bin = dir.join(".local/bin");
    fs::create_dir_all(&bin).expect("bin dir");
    let probe = script(&bin, "sec-digest-probe", "#!/bin/sh\nexit 0\n");
    let _guard = CHAIN_ENV.lock().unwrap_or_else(|poison| poison.into_inner());
    let old_home = std::env::var_os("HOME");
    let old_path = std::env::var_os("PATH");
    std::env::set_var("HOME", &dir);
    std::env::set_var("PATH", "/nonexistent");
    let found = llm::resolve_binary("sec-digest-probe");
    match old_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    match old_path {
        Some(value) => std::env::set_var("PATH", value),
        None => std::env::remove_var("PATH"),
    }
    assert_eq!(found, Some(probe), "EXTRA_BIN/.local/bin must be searched without PATH");
}

#[test]
fn the_prompt_carries_the_run_counts_and_only_real_ids_are_allowed() {
    let record = record();
    let prompt = llm::prompt::build(&record);
    assert!(prompt.contains("\"advisories_read\": 7"), "{prompt}");
    assert!(prompt.contains("\"touching_your_stack\": 3"), "{prompt}");
    assert!(prompt.contains("CVE-2026-7001"), "{prompt}");
    assert!(prompt.contains("versions: Linux kernel: 5.15.0-203"), "{prompt}");
    let allowed = llm::prompt::allowed_ids(&record);
    assert!(allowed.contains("CVE-2026-7001"));
    assert!(allowed.contains("USN-9002-1"));
    assert!(!allowed.contains("CVE-2099-99999"));
}
