# Open questions

Everything this analysis could not resolve from the repository, plus the claims that could not be
verified. Each question names why it blocks a decision and who can answer it.

## Questions that block design decisions

| ID | Question | Why it blocks | Evidence in the repository | Who decides |
|---|---|---|---|---|
| OQ-00 | Which end-state wins: the confirmed single-backend plan (the panel as write backend) or the Rust backend task? | They contradict; almost every other design choice depends on the answer. | `docs/PLAN-SINGLE-BACKEND.md` is user-confirmed and being implemented; this document set specifies the opposite | Owner |
| OQ-01 | Which checkout is the canonical state for the move, given that the worktrees have diverged? | The comparison, the parity tests, and the invariants all depend on the baseline. This set uses `feat/requirements-catalog`. | Three registered worktrees: `feat/requirements-catalog` (`cms-re-catalog`), `feat/migration-management` (`cms-migrations`), `feat/mobile-nav-ui` (`cms-docker`) | Owner |
| OQ-02 | Which branch actually runs in production today? | A move cannot be planned against a branch that is not deployed. | `docs/UPGRADE-RBAC-RELEASE.md:32-37` describes a cutover to `feat/requirements-catalog`; not confirmed as deployed | Owner |
| OQ-03 | What upstream pin should be recorded, so future syncs are diffable? | Without a pin, "what changed versus upstream" is unanswerable, which is the core cost in `CONTEXT.md`. | `docs/FORK-SUMMARY.md` records a best-supported base only | Owner and upstream maintainer |
| OQ-04 | Should the replacement carry a per-caller identity on the RPC transport, or keep one shared secret? | It changes the security requirement set and the transport design. | `src/cms/io/rpc.py:443-445` has one secret and no caller identity | Owner |
| OQ-05 | Is the `pg_largeobject` row-level-security exemption acceptable permanently? | If not, an alternative file-storage design is required before any move. | `admin-panel/prisma/sql/20260820130000_rls.sql:15`; `admin-panel/src/lib/fsobjects.ts` | Owner |
| OQ-06 | Is the inability to enforce contestant row ownership at the database layer acceptable? | It limits how much of authorization can move into the database. | Documented limitation; the contestant path shares the application connection | Owner |
| OQ-07 | How is "the participant experience is unchanged" proven, and who signs it off? | REQ-F11 depends on a method that does not exist yet. | No behavioural test harness for the participant surface was found | Owner and operators |
| OQ-08 | Which contest formats must the end-to-end rehearsal cover? | Training for national and international olympiads implies specific formats and task types. | Task types under `src/cms/grading/tasktypes/` | Owner |
| OQ-09 | Which of the three scopes is intended: full replacement, services plus admin API, or admin API only? | The architecture and the effort estimate differ by an order of magnitude. | This decision was deliberately left open | Owner |
| OQ-10 | How should container control be exposed once the panel loses the Docker socket? | The current panel holds a root-equivalent socket; the replacement must not. | `admin-panel/src/app/actions/docker.ts`, `admin-panel/src/app/actions/services.ts` | Owner and security reviewer |
| OQ-11 | Where should the Rust workspace live, and how is it deployed? | Repository layout and release process are unaddressed. | The Rust TUI lives at `tools/cms-tui` inside the baseline checkout | Owner |
| OQ-13 | Is a generated API contract (OpenAPI) the required form of API documentation, and is `utoipa` acceptable? | REQ-P06 assumes it; the tool choice is unconfirmed. | No API documentation generator exists today | Owner |

## Contradictions found and how they were resolved

| Contradiction | Resolution used here | Risk if wrong |
|---|---|---|
| `docs/FORK-SUMMARY.md` says `submissions` has no DELETE for any role; the policy SQL grants DELETE to the application role. | The SQL is treated as ground truth (`admin-panel/prisma/sql/20260820130000_rls.sql:227-236`). | Low; the SQL is the enforced artefact. The stale prose should be corrected. |
| `docs/UPGRADE-RBAC-RELEASE.md` mentions `cms_admin` and `cms_monitor` roles; the role SQL defines exactly two roles. | The SQL is treated as ground truth (`admin-panel/prisma/sql/20260820120000_db_roles.sql:1-52`). | Low; but an operator following the guide would create roles that should not exist. |
| The task statement describes the RPC secret as present; it is present on this baseline but absent on `major/admin-panel`. | This set describes the baseline only, and notes the difference. | Medium; if the intended baseline is the other branch, the transport section is wrong. |
| `.omo/plans/migration-management.md` is titled as a proposal but reads like a specification. | Treated as an input, not authority; its own header says it is not approved. | Low. |

## Claims that could not be verified

Stated plainly, so no reader assumes more than was checked:

- **The four repository parity gates were not run.** `scripts/__check_spec_parity.sh`,
  `scripts/__check_audit_coverage.sh`, `scripts/__check_permission_parity.sh`, and
  `scripts/__check_rls_coverage.sh` are named in `.omo/plans/migration-management.md:§9`; their
  current pass or fail state was not observed.
- **No live database was inspected.** Every row-level-security, role, and policy statement is read
  from the SQL files, not from a running cluster.
- **The ranking web server was inspected only at its route table.** Data-flow and event-stream
  behaviour were not traced in depth.
- **No test was executed** on either the Python or the TypeScript side. Test counts and pass rates
  quoted by repository documents were not reproduced.
- **Deployed branch and deployed configuration were not determined.** Only the repository's own
  upgrade guide was read.
- **No performance property was measured or asserted.** No performance data exists in the
  repository.
- **The upstream comparison was not performed.** No upstream fetch was made; the fork relationship
  is reported as the repository's own summary describes it.
- **Large-object read authorization for the contestant path was not traced end to end.** The
  documented exemption was read, not exercised.

## Decisions already made for this document set

| Decision | Choice |
|---|---|
| Baseline | `feat/backend-rust`, cut from `feat/requirements-catalog` at `b6103ed9` |
| Output location | `docs/backend-migration/` on the `feat/backend-rust` branch, in its own worktree |
| Scope | compare all components; select none |
| Deliverable | analysis and specification only; no code |

## Measured at the trunk reconciliation (S-0), 2026-11-22

The merge `27768790` (parents `90fdb8ed` = `feat/backend-rust`, `eb3549ee` =
`major/admin-panel`, fork point `b23a8fbf`) is where these were observed. Each line is a command
and its result, not a recollection.

| Finding | Evidence |
|---|---|
| The trunk tip has moved since this set's baseline: `90fdb8ed` is now `origin/feat/backend-rust`, and `90fdb8ed` is **not** an ancestor of the local `feat/backend-rust` (`5c15d928`, 5 commits ahead, same subjects, identical `git patch-id`s for 4 of them). `git fetch origin` reports `18 5` in `rev-list --left-right --count origin/feat/backend-rust...feat/backend-rust`. | The local trunk is a rebase of the origin one; the brief's declared trunk is the origin one. |
| **`tools/cms-tui` is two incompatible implementations** that the merge resolved by taking the panel tree for 60 files and the trunk manifest for `Cargo.toml`. Each tip compiles alone (`cargo check --all-targets` exit 0 at both `90fdb8ed` and `eb3549ee`); the merged tree did not (17 rustc errors). | Resolved in `f1e0d47d`: the 22 bare `crossterm::` sites now route through `ratatui::crossterm`, which is what `20dc0339` decided when it dropped the direct dependency. **No new dependency was added.** |
| The merge silently prefers the panel side: of the 40 files both lines touched since the fork, 34 were resolved to panel and 0 to trunk. 26 of those 34 are under `tools/cms-tui`. | `git rev-parse <rev>:<path>` compared across `b23a8fbf`/`90fdb8ed`/`eb3549ee`/`HEAD`. |
| 11 trunk-reachable `cms-tui` files are now unreachable (no `mod x;` and no `#[path]`): `cli/domain_args.rs`, `cli/sub_enums.rs`, `core/config_schema.rs`, `core/config_schema_kinds.rs`, `core/config_schema_tests.rs`, `core/docker_targets.rs`, `tui/components/config_field.rs`, `tui/menus_tests.rs`, `tui/pages/domain_render.rs`, `tui/pages/domain_submit_tests.rs`, `tui/stack_entries.rs`. The panel tip already had 4 dead files of its own (`keys.rs`, `menu.rs`, `style.rs`, `tui/pages/domain_tests.rs`), so being unreachable is not by itself merge damage. | Owner decision 2026-11-22: the panel line wins; these stay unreachable and only refactoring work is in scope. Recorded rather than deleted, so a later port has a source to read. |
| The branch the brief names as the gate for `admin-panel` (`bun test`) does not exist as a gate. `package.json` defines `"test": "vitest run"`; `bun test` runs Bun's own runner, which ignores `vitest.config.ts` and hangs (exit 124 at a 90 s cap) on `tests/with-timeout.test.ts`. No script, workflow or Makefile invokes `bun test`. | `bun run test` → 382 files / 5082 tests passed, exit 0, 65 s. The brief's gate line should read `bun run test`. |
| `backend` has one pre-existing, non-deterministic failure: `cms-worker --test sandbox_drain`, `sandbox_drain.rs:57`, `Unlaunchable { source: Os { code: 26, ExecutableFileBusy } }` on `backend/target/tmp/started/isolate`. Alone it passes 3/3; under full-suite parallelism it fails. The brief sites this in `sandbox_launch`; it is in `sandbox_drain`. | Not fixed here — a pre-existing race, reported with its line. `cargo test --test sandbox_drain` used as the isolation check. |
| `admin-panel/DESIGN-PREFERENCE.md` was modified in the working tree mid-run by a concurrent writer (mtime inside the `vitest` window, content is the frontend session's Material 3 topic log). It is not part of this lane's commits. | `git status` before/after; not staged, not touched. |
| `docs/backend-migration/PLAN.md` and `PERSPECTIVES.md`, which the brief cites for the 9 decisions / 12 domains / S-0…S-9 order, do not exist on this tree. The set present is `ARCHITECTURE.md`, `CONTEXT.md`, `INVENTORY.md`, `MIGRATION-OPTIONS.md`, `OPEN-QUESTIONS.md`, `REQUIREMENTS.md`, `THREAT-MODEL.md`. | `ls docs/backend-migration/`. The slice order in the brief has no in-tree source, so it is carried as the brief states it until a `PLAN.md` lands. |
