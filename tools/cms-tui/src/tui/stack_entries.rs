//! Stack menu rows, built from `ALL_STACKS` so the set of stacks and their make
//! targets are declared once.
//!
//! These rows are hand-written rather than catalog entries because every stack
//! lifecycle command is a make target derived from the stack name, and the TUI
//! shows the per-stack and all-stacks variants side by side.

use crate::core::docker_targets::{ALL_STACKS, DEPLOY_ALL_ORDER};

/// Menu row: label, command, requires a TTY, requires sudo, capture output.
type Row = (String, String, bool, bool, bool);

/// Prefix that selects pre-built images, matching the `./cms` dispatcher. It
/// carries its own trailing space because it is concatenated onto `make`.
const IMAGE_DEPLOY_PREFIX: &str = "DEPLOYMENT_TYPE_OVERRIDE=img ";

fn capitalize(input: &str) -> String {
    let mut chars = input.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let mut out = String::new();
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
            out
        }
    }
}

/// Rows that deploy one stack, then all of them, then the same set again with
/// the image deployment prefix.
pub fn stack_deploy_entries() -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    for (label_suffix, command_prefix) in [("", ""), (" (--img)", IMAGE_DEPLOY_PREFIX)] {
        for stack in ALL_STACKS {
            rows.push((
                format!("Deploy {}{label_suffix}", capitalize(stack)),
                format!("{command_prefix}make {stack}"),
                true,
                false,
                false,
            ));
        }
        rows.push((
            format!("Deploy All{label_suffix}"),
            format!("{command_prefix}make {}", DEPLOY_ALL_ORDER.join(" ")),
            true,
            false,
            false,
        ));
    }
    rows
}

/// Rows that stop, clean and pull one stack or all of them.
pub fn stack_control_entries() -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    for (verb, suffix) in [("Stop", "-stop"), ("Clean", "-clean")] {
        for stack in ALL_STACKS {
            rows.push(per_stack_row(
                &format!("{verb} {}", capitalize(stack)),
                stack,
                suffix,
            ));
        }
        let all: Vec<String> = ALL_STACKS
            .iter()
            .map(|stack| format!("{stack}{suffix}"))
            .collect();
        rows.push((
            format!("{verb} All"),
            format!("make {}", all.join(" ")),
            true,
            false,
            false,
        ));
    }
    for stack in ALL_STACKS {
        rows.push(per_stack_row(
            &format!("Pull {}", capitalize(stack)),
            &format!("pull-{stack}"),
            "",
        ));
    }
    rows.push((
        "Pull All".to_string(),
        "make pull".to_string(),
        true,
        false,
        false,
    ));
    rows
}

fn per_stack_row(label: &str, target: &str, prefix: &str) -> Row {
    (
        label.to_string(),
        format!("make {prefix}{target}"),
        true,
        false,
        false,
    )
}
