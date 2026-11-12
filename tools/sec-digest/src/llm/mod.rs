//! The model chain: first usable answer wins, and it may not name an id we did not read.

mod chain;
mod exec;
pub mod prompt;
pub mod validate;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

use crate::record::RunRecord;
use crate::text::take_chars;

use chain::Slot;

/// The cron-PATH rule, exposed so a test can prove it without a model call.
pub fn resolve_binary(name: &str) -> Option<std::path::PathBuf> {
    exec::resolve(name)
}

static ANSI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").expect("static ANSI pattern"));

pub struct Outcome {
    pub text: String,
    pub model: String,
    pub reasons: Vec<String>,
}

impl Outcome {
    fn fallback(reasons: Vec<String>) -> Self {
        Self {
            text: String::new(),
            model: "none".to_string(),
            reasons,
        }
    }
}

/// Empty text means every slot failed; the caller then renders the template.
pub fn write_brief(record: &RunRecord, state_dir: &Path) -> Outcome {
    let path = chain::path();
    let chain = match chain::load(&path) {
        Ok(chain) => chain,
        Err(error) => {
            let reason = format!("chain unusable: {error}");
            eprintln!("[llm] {reason}");
            save(state_dir, std::slice::from_ref(&reason));
            return Outcome::fallback(vec![reason]);
        }
    };
    let prompt = prompt::build(record);
    let allowed = prompt::allowed_ids(record);
    let mut reasons: Vec<String> = Vec::new();
    for slot in &chain.slots {
        match try_slot(slot, &prompt, &allowed) {
            Ok(text) => {
                save(state_dir, &reasons);
                return Outcome {
                    text,
                    model: slot.label().to_string(),
                    reasons,
                };
            }
            Err(reason) => {
                eprintln!("[llm] {reason}");
                reasons.push(reason);
            }
        }
    }
    save(state_dir, &reasons);
    Outcome::fallback(reasons)
}

fn try_slot(slot: &Slot, prompt: &str, allowed: &BTreeSet<String>) -> Result<String, String> {
    let label = slot.label();
    if slot.cmd.is_empty() {
        return Err(format!("{label}: no cmd"));
    }
    let argv = slot.argv(prompt);
    let binary = exec::resolve(&argv[0]).ok_or_else(|| {
        format!(
            "{label}: binary {:?} not found (PATH + {})",
            argv[0],
            exec::extra_bin_display()
        )
    })?;
    if let Some(dir) = &slot.workdir {
        fs::create_dir_all(dir)
            .map_err(|error| format!("{label}: workdir {}: {error}", dir.display()))?;
    }
    let timeout = Duration::from_secs(slot.timeout.max(1));
    let answer = exec::run(&binary, &argv[1..], timeout, slot.workdir.as_deref())
        .map_err(|error| format!("{label}: {error}"))?;
    if answer.code != 0 {
        let tail = last_line(&answer.stderr)
            .or_else(|| last_line(&answer.stdout))
            .unwrap_or_default();
        return Err(format!(
            "{label}: exit {} {}",
            answer.code,
            take_chars(&tail, 120)
        )
        .trim_end()
        .to_string());
    }
    let text = tidy(&answer.stdout);
    validate::check(&text, allowed).map_err(|why| format!("{label}: rejected ({why})"))?;
    Ok(text)
}

/// A CLI update banner or an agent preamble is not part of the brief.
fn tidy(stdout: &str) -> String {
    let clean = ANSI.replace_all(stdout, "");
    let out = clean.trim();
    match out.find("## ") {
        Some(cut) if cut > 0 => out[cut..].trim().to_string(),
        _ => out.to_string(),
    }
}

fn last_line(text: &str) -> Option<String> {
    let clean = ANSI.replace_all(text, "");
    clean
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn save(state_dir: &Path, reasons: &[String]) {
    let runs = state_dir.join("runs");
    if let Err(error) = fs::create_dir_all(&runs) {
        eprintln!("[llm] cannot create {}: {error}", runs.display());
        return;
    }
    let path = state_dir.join("last_llm_reasons.json");
    let body = serde_json::to_string_pretty(reasons).unwrap_or_else(|_| "[]".to_string());
    if let Err(error) = fs::write(&path, body) {
        eprintln!("[llm] cannot write {}: {error}", path.display());
    }
}
