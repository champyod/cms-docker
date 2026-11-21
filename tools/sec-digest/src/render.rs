//! Render the brief. No model involved on this path, and no invented facts.
//!
//! Every section is a function of the ranked rows: same input, same bytes.

use chrono::{DateTime, Utc};

use crate::fleet_state::{as_lines_at, FleetState};
use crate::inventory::Inventory;
use crate::model::Advisory;
use crate::rank::{Sections, Stats};
use crate::text::{char_len, take_chars};
use crate::timeutil::now_utc;

/// Repo and host facts are never trimmed: they are the part an operator acts on.
const PROTECTED: [&str; 2] = ["REPO", "SERVER"];
const TRIM_NOTE: &str = "_(trimmed to fit; full brief in the run record)_";

pub struct BriefInput<'a> {
    pub window_hours: u32,
    pub sections: &'a Sections,
    pub stats: &'a Stats,
    pub inventory: &'a Inventory,
    pub collector_errors: &'a [String],
}

/// `**ID** · products · SEVERITY score · exploited · new`
fn headline(item: &Advisory) -> String {
    let mut head = format!("**{}** · {}", item.id, item.product_labels());
    let severity = item.severity.to_uppercase();
    let score = item
        .score
        .filter(|value| *value != 0.0)
        .map(|value| format!("{value:.1}"))
        .unwrap_or_default();
    if !severity.is_empty() || !score.is_empty() {
        let tail = format!(
            "{severity}{}",
            if score.is_empty() {
                String::new()
            } else {
                format!(" {score}")
            }
        );
        head.push_str(" · ");
        head.push_str(&tail);
    }
    if item.exploited {
        head.push_str(" · **exploited in the wild**");
    }
    if item.fresh {
        head.push_str(" · new");
    }
    head
}

fn bullet(item: &Advisory) -> String {
    let mut bits: Vec<String> = vec![headline(item)];
    if !item.title.is_empty() && item.title != item.id {
        bits.push(format!("  {}", take_chars(&item.title, 180)));
    }
    let matches = item.detail_list("matches_ours");
    if !matches.is_empty() {
        bits.push(format!("  your version: {}", take_chars(&matches.join("; "), 160)));
    } else if let Some(fixed) = item.detail_str("fixed") {
        if !fixed.is_empty() {
            bits.push(format!("  fixed in: {fixed}"));
        }
    }
    if !item.url.is_empty() {
        bits.push(format!("  <{}>", item.url));
    }
    bits.join("\n")
}

fn push_bullets(out: &mut Vec<String>, items: &[Advisory]) {
    if items.is_empty() {
        out.push("nothing new".to_string());
        return;
    }
    for item in items {
        out.push(bullet(item));
    }
}

fn today_lines(input: &BriefInput) -> Vec<String> {
    let mut lines = vec![format!(
        "window {}h · {} advisories read, {} touch your stack",
        input.window_hours, input.stats.merged, input.stats.ours
    )];
    for host in &input.inventory.hosts {
        lines.push(format!("{}: {}, kernel {}", host.name, host.os, host.kernel));
    }
    if !input.collector_errors.is_empty() {
        lines.push(format!(
            "could not read: {}",
            take_chars(&input.collector_errors.join("; "), 300)
        ));
    }
    lines
}

pub fn template_brief(input: &BriefInput) -> String {
    let sections = input.sections;
    let mut out = vec!["## ACT NOW".to_string()];
    push_bullets(&mut out, &sections.act_now);
    out.push("## WATCH".to_string());
    push_bullets(&mut out, &sections.watch);
    out.push("## INDUSTRY".to_string());
    push_bullets(&mut out, &sections.industry);
    if sections.rest_critical > 0 {
        out.push(format!(
            "+ {} further critical advisories in this window that are neither yours nor widely deployed",
            sections.rest_critical
        ));
    }
    out.push("## NEWS".to_string());
    if sections.news.is_empty() {
        out.push("nothing new".to_string());
    } else {
        for news in &sections.news {
            out.push(format!(
                "• {} <{}>",
                take_chars(&news.title, 150),
                news.url.clone().unwrap_or_default()
            ));
        }
    }
    out.push("## TODAY FOR YOU".to_string());
    out.push(today_lines(input).join("\n"));
    out.join("\n")
}

pub fn nothing_new(window_hours: u32, stats: &Stats, collector_errors: &[String]) -> String {
    let mut text = format!(
        "## TODAY FOR YOU\nNo new advisories in the last {window_hours}h touch your stack ({} read across KEV/USN/Arch/GHSA/NVD).\n",
        stats.merged
    );
    if !collector_errors.is_empty() {
        text.push_str(&format!(
            "could not read: {}",
            take_chars(&collector_errors.join("; "), 300)
        ));
    }
    text
}

/// `(heading, body)` pairs; a heading with an empty body is not a section.
fn split_sections(text: &str) -> Vec<(String, String)> {
    let mut parts: Vec<(String, String)> = Vec::new();
    let mut title: Option<String> = None;
    let mut buffer: Vec<&str> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            if let Some(previous) = title.take() {
                parts.push((previous, buffer.join("\n").trim().to_string()));
                buffer.clear();
            }
            title = Some(rest.trim().to_string());
        } else if line.starts_with("# ") {
            continue;
        } else {
            buffer.push(line);
        }
    }
    if let Some(previous) = title {
        parts.push((previous, buffer.join("\n").trim().to_string()));
    }
    parts.retain(|(_, body)| !body.is_empty());
    if parts.is_empty() {
        return vec![("Security digest".to_string(), text.trim().to_string())];
    }
    parts
}

fn is_protected(title: &str) -> bool {
    PROTECTED.contains(&title.to_uppercase().as_str())
}

fn truncated_body(body: &str, cap: usize) -> String {
    let mut cut: String = body.chars().take(cap).collect::<String>().trim_end().to_string();
    if let Some(byte) = cut.rfind('\n') {
        // Never end mid-bullet; the char index is what the budget was measured in.
        if cut[..byte].chars().count() > cap / 2 {
            cut.truncate(byte);
        }
    }
    format!("{}…", cut.trim_end())
}

/// Discord rejects message content over 2000 chars and a cron delivery is one
/// message, so trim section bodies proportionally instead of losing the brief.
pub fn fit_for_chat(text: &str, limit: usize) -> String {
    if char_len(text) <= limit {
        return text.to_string();
    }
    let sections = split_sections(text);
    let fixed: usize = sections
        .iter()
        .filter(|(title, _)| is_protected(title))
        .map(|(title, body)| char_len(body) + char_len(title) + 8)
        .sum();
    let flexible = sections.iter().filter(|(title, _)| !is_protected(title)).count();
    let budget = limit.saturating_sub(200).saturating_sub(fixed).max(300);
    // With no flexible sections every byte goes to the protected ones; budget is
    // always at least 300, so dividing by 1 and clamping can never overspend.
    let per = (budget / flexible.max(1)).max(120).min(budget);
    let mut out: Vec<String> = Vec::new();
    for (title, body) in sections {
        let cap = if is_protected(&title) { usize::MAX } else { per };
        if char_len(&body) <= cap {
            out.push(format!("## {title}\n{body}"));
            continue;
        }
        out.push(format!("## {title}\n{}", truncated_body(&body, cap)));
    }
    format!("{}\n\n{TRIM_NOTE}", out.join("\n"))
}

pub fn fleet_block_at(state: &FleetState, now: DateTime<Utc>) -> String {
    let (repos, servers) = as_lines_at(state, now);
    let mut out = vec!["## REPO".to_string()];
    if repos.is_empty() {
        out.push("nothing read".to_string());
    } else {
        out.extend(repos.iter().map(|line| format!("- {line}")));
    }
    out.push("## SERVER".to_string());
    if servers.is_empty() {
        out.push("nothing read".to_string());
    } else {
        out.extend(servers.iter().map(|line| format!("- {line}")));
    }
    out.join("\n")
}

pub fn fleet_block(state: &FleetState) -> String {
    fleet_block_at(state, now_utc())
}
