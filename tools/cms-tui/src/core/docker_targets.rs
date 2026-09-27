//! Which `make` targets a stack lifecycle command runs.
//!
//! Resolution is kept apart from execution so the mapping can be read — and
//! tested — without spawning anything: the CLI and the TUI both resolve through
//! these functions, which is what keeps `./cms deploy all` and the TUI's Deploy
//! All row in the same order.

/// The five make-target stacks that mirror `./cms deploy`/`stop`/`pull`.
pub const ALL_STACKS: [&str; 5] = ["core", "admin", "contest", "worker", "infra"];

/// Deploy order used by `./cms deploy all` (core first, worker last).
pub const DEPLOY_ALL_ORDER: [&str; 5] = ["core", "infra", "admin", "contest", "worker"];

/// Value that asks for every stack at once.
const ALL_STACKS_ARG: &str = "all";

/// Represents a stack lifecycle failure that is not a process error.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DockerError {
    #[error("unknown stack `{0}`: expected one of core, admin, contest, worker, infra, or all")]
    UnknownStack(String),
    #[error("no stack given: pass one of core, admin, contest, worker, infra, or all")]
    MissingStack,
}

/// A stack lifecycle command. One row per variant in [`STACK_TARGETS`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
enum Operation {
    Deploy = 0,
    Stop = 1,
    Clean = 2,
    Pull = 3,
}

/// The `make` targets one command runs: the text wrapped around a stack name,
/// plus the all-stacks form where that text does not determine it.
#[derive(Clone, Copy)]
struct StackTargets {
    prefix: &'static str,
    suffix: &'static str,
    all: AllTargets,
}

/// How a command spells the all-stacks form.
#[derive(Clone, Copy)]
enum AllTargets {
    /// One target per stack, in `DEPLOY_ALL_ORDER`.
    InDeployOrder,
    /// One target per stack, in `ALL_STACKS`.
    PerStack,
    /// One target that already covers every stack.
    One(&'static str),
}

const STACK_TARGETS: [StackTargets; 4] = [
    StackTargets {
        prefix: "",
        suffix: "",
        all: AllTargets::InDeployOrder,
    },
    StackTargets {
        prefix: "",
        suffix: "-stop",
        all: AllTargets::PerStack,
    },
    StackTargets {
        prefix: "",
        suffix: "-clean",
        all: AllTargets::PerStack,
    },
    // WHY: `pull` rebuilds every image from one target, so the all-stacks form
    // is a single target instead of one per stack.
    StackTargets {
        prefix: "pull-",
        suffix: "",
        all: AllTargets::One("pull"),
    },
];

// WHY: a command without a table row would resolve as some other command's
// targets, so the row count is pinned to the last operation here.
const _: () = assert!(Operation::Pull.row_count() == STACK_TARGETS.len());

impl Operation {
    const fn row(self) -> StackTargets {
        STACK_TARGETS[self as usize]
    }

    /// Row count implied by the operation list, used to tie it to the table.
    const fn row_count(self) -> usize {
        self as usize + 1
    }

    /// `prefix + stack + suffix`, the shape every single-stack target takes.
    fn spell(self, stack: &str) -> String {
        let StackTargets { prefix, suffix, .. } = self.row();
        format!("{prefix}{stack}{suffix}")
    }

    /// The targets a command runs when every stack is requested at once.
    fn every_stack(self) -> Vec<String> {
        match self.row().all {
            AllTargets::InDeployOrder => DEPLOY_ALL_ORDER.iter().map(|s| self.spell(s)).collect(),
            AllTargets::PerStack => ALL_STACKS.iter().map(|s| self.spell(s)).collect(),
            AllTargets::One(target) => vec![target.to_string()],
        }
    }
}

/// Resolves deploy make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is empty or unknown.
pub fn deploy_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    if stack.is_empty() {
        return Err(DockerError::MissingStack);
    }
    resolve(Operation::Deploy, stack)
}

/// Resolves stop make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is unknown.
pub fn stop_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    resolve(Operation::Stop, stack)
}

/// Builds the ordered sequence of `make` targets for a clean request.
///
/// # Errors
///
/// Returns `Err` if `stack` is unknown.
pub fn clean_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    resolve(Operation::Clean, stack)
}

/// Resolves pull make targets for `stack`.
///
/// # Errors
///
/// Returns `Err` if `stack` is empty or unknown.
pub fn pull_targets(stack: &str) -> Result<Vec<String>, DockerError> {
    resolve(Operation::Pull, stack)
}

/// Resolves one stack, or every stack at once, through the command's table row.
///
/// An empty stack resolves like `all` because every caller declares `all` as the
/// default, and clap passes the default rather than an empty value.
fn resolve(operation: Operation, stack: &str) -> Result<Vec<String>, DockerError> {
    if ALL_STACKS.contains(&stack) {
        return Ok(vec![operation.spell(stack)]);
    }
    if stack.is_empty() || stack == ALL_STACKS_ARG {
        return Ok(operation.every_stack());
    }
    Err(DockerError::UnknownStack(stack.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    type Resolve = fn(&str) -> Result<Vec<String>, DockerError>;

    #[test]
    fn every_command_spells_one_stack() {
        let cases: [(Resolve, &str, &str); 5] = [
            (deploy_targets, "core", "core"),
            (deploy_targets, "admin", "admin"),
            (stop_targets, "core", "core-stop"),
            (clean_targets, "worker", "worker-clean"),
            (pull_targets, "infra", "pull-infra"),
        ];
        for (resolve, stack, target) in cases {
            assert_eq!(
                resolve(stack).unwrap(),
                vec![target.to_string()],
                "target for {stack}"
            );
        }
    }

    #[test]
    fn every_command_expands_all_stacks() {
        let cases: [(Resolve, &[&str]); 4] = [
            (
                deploy_targets,
                &["core", "infra", "admin", "contest", "worker"],
            ),
            (
                stop_targets,
                &[
                    "core-stop",
                    "admin-stop",
                    "contest-stop",
                    "worker-stop",
                    "infra-stop",
                ],
            ),
            (
                clean_targets,
                &[
                    "core-clean",
                    "admin-clean",
                    "contest-clean",
                    "worker-clean",
                    "infra-clean",
                ],
            ),
            (pull_targets, &["pull"]),
        ];
        for (resolve, targets) in cases {
            let expected: Vec<String> = targets.iter().map(ToString::to_string).collect();
            assert_eq!(resolve("all").unwrap(), expected);
        }
    }

    #[test]
    fn an_empty_stack_means_every_stack_except_for_deploy() {
        for resolve in [stop_targets, clean_targets, pull_targets] {
            assert_eq!(resolve("").unwrap(), resolve("all").unwrap());
        }
        assert_eq!(deploy_targets(""), Err(DockerError::MissingStack));
    }

    #[test]
    fn an_unknown_stack_is_refused_by_every_command() {
        for resolve in [deploy_targets, stop_targets, clean_targets, pull_targets] {
            assert_eq!(
                resolve("bogus"),
                Err(DockerError::UnknownStack("bogus".into()))
            );
        }
    }

    #[test]
    fn clean_all_never_resolves_to_the_bare_clean_target() {
        let targets = clean_targets("all").unwrap();
        assert!(
            !targets.iter().any(|target| target == "clean"),
            "`clean all` must never resolve to the bare `clean` target, which removes the generated .env"
        );
    }
}
