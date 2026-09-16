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
