# Requirements

Each requirement is individually identifiable and testable. It carries the source it derives from,
acceptance criteria, and a priority. Priority is P0 (must hold before any replacement is accepted),
P1 (required for equivalence), or P2 (valuable, deferrable).

The requirement set describes a replacement backend and the constraints on its delivery. It does
not select a migration strategy; the strategies are in `MIGRATION-OPTIONS.md`.

## Security requirements

| ID | Requirement | Source | Acceptance criteria | Priority |
|---|---|---|---|---|
| REQ-S01 | Every inter-service RPC is authenticated with the shared secret, and the check fails closed when the secret is unset. | `src/cms/io/rpc.py:62-74`, `:443-445` | A request without a valid secret is rejected; with no secret configured, all requests are rejected; both cases are covered by an automated test. | P0 |
| REQ-S02 | The RPC secret is never written to logs or error messages. | `src/cms/io/rpc.py:443-445` | No log line or exception message contains the secret value under any rejected-request path. | P1 |
| REQ-S03 | The 1 MiB message cap is enforced in both directions. | `src/cms/io/rpc.py:117`, `:279`, `:315` | An oversized message is dropped, the connection is torn down, and the peer observes a transport error; the cap value is unchanged. | P1 |
| REQ-S04 | Row-level security remains enabled and forced on all 33 application tables. | `admin-panel/prisma/sql/20260820130000_rls.sql` | The coverage gate reports no table missing `ENABLE` or `FORCE`; the table set matches the model list. | P0 |
| REQ-S05 | `audit_log` remains append-only: SELECT and INSERT policies only, for every role. | `admin-panel/prisma/sql/20260820130000_rls.sql:218-223` | An UPDATE and a DELETE against `audit_log` affect zero rows for every role, including the owner and the backup role. | P0 |
| REQ-S06 | `submissions` DELETE stays permitted only through a governed path: permission check, required reason, and an audit entry. | `admin-panel/prisma/sql/20260820130000_rls.sql:227-236` | The DELETE policy exists for the application role; an unaudited delete path is rejected by review and test; the audit row is written before the delete commits. | P0 |
| REQ-S07 | The application role stays demoted: NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB. | `admin-panel/prisma/sql/20260820140000_owner_hardening.sql` | The role attributes are exactly these after bootstrap; a regression test fails otherwise. | P0 |
| REQ-S08 | The backup role keeps LOGIN, BYPASSRLS, and membership in the application role. | `admin-panel/prisma/sql/20260820120000_db_roles.sql:15-52` | A `pg_dump` as the backup role succeeds; the membership is present; no third role is introduced. | P0 |
| REQ-S09 | Permission enforcement is server-side with a single source of truth; client checks are UX only. | `admin-panel/src/lib/permission-registry.ts`, `permission-engine.ts` | Every mutation resolves against the registry; no server path trusts a client-declared permission; the decision is audit-logged. | P0 |
| REQ-S10 | Auth and permission checks fail closed: missing or invalid session, proxy, or database state denies. | `admin-panel/src/lib/auth.ts`, `admin-panel/src/lib/permissions.ts:72` | With the database unavailable, protected routes return 401/403 and never fall back to public behaviour. | P0 |
| REQ-S11 | Untrusted submission code runs only inside a real isolation sandbox. | `src/cms/grading/Sandbox.py` (`IsolateSandbox` at `:876`, default selection at `:1514-1520`) | The selected sandbox is the isolating one; no configuration or code path can select the non-isolating sandbox for contestant code. | P0 |
| REQ-S12 | Secrets are confined to server-side code, environment, and HTTP-only cookies; no secret reaches the browser. | `admin-panel/src/lib/auth.ts`, `admin-panel/src/app/actions/env.ts` | No `NEXT_PUBLIC_` variable carries a secret; no secret appears in client bundles or URLs. | P0 |
| REQ-S13 | All SQL is parameterised through the ORM or a bound-parameter API. | `admin-panel/src/app/actions/tasks.ts:170`, `admin-panel/src/app/actions/participation-sql.ts:86` | No string-interpolated value reaches the database; the string-built `SET` clause paths are replaced or provably safe. | P1 |
| REQ-S14 | The grading queue resists submission flooding and denial of service. | `src/cms/service/EvaluationService.py:881`, `:1085` | Sustained submission pressure does not starve the queue; per-participant and per-contest limits are enforced before enqueue. | P1 |
| REQ-S15 | File and large-object access control is explicit and documented. | `admin-panel/src/lib/fsobjects.ts:16-26`, `admin-panel/prisma/sql/20260820130000_rls.sql:15` | The exemption for large-object bytes is documented; no unauthenticated path reads a large object; metadata rows stay RLS-gated. | P1 |
| REQ-S16 | All input crossing a trust boundary is validated and bounded. | `admin-panel/src/lib/api-utils.ts`, `admin-panel/src/lib/contest-validation.ts` | Malformed, oversized, and wrong-type inputs are rejected before reaching the database or a container operation. | P1 |

## Compatibility requirements

| ID | Requirement | Source | Acceptance criteria | Priority |
|---|---|---|---|---|
| REQ-F01 | The participant-facing contest surface behaves identically. | `src/cms/server/contest/handlers/__init__.py:65-107` | Every listed route returns the same status, payload shape, and side effects; golden end-to-end tests pass. | P0 |
| REQ-F02 | The ranking surface behaves identically, including the live event stream. | `src/cmsranking/RankingWebServer.py:83-88`, `:506-511` | Scores, history, events, and logo endpoints match current output. | P0 |
| REQ-F03 | The Python admin web server's 75 routes retain equivalent behaviour. | `src/cms/server/admin/handlers/__init__.py:111-224` | Each route has a mapped equivalent or an explicit, approved retirement. | P1 |
| REQ-F04 | The admin panel's 28 API handlers retain equivalent behaviour. | `admin-panel/src/app/api/**` | Each handler has a mapped equivalent with the same method, shape, and permission. | P1 |
| REQ-F05 | Operator entry points retain their surface: service scripts, data tools, launcher, Makefile targets, TUI. | `src/setup.py:121-163`, `Makefile:55-405`, `cms:100,154`, `tools/cms-tui/src/cli/mod.rs:122` | Each command still exists with the same arguments and effect, or an approved replacement is documented. | P1 |
| REQ-F06 | The transport wire format is preserved, so old and new components interoperate during a phased move. | `src/cms/io/rpc.py` (framing, `__secret`) | A new component and a current component exchange a request and a response successfully. | P1 |
| REQ-F07 | The configuration surface is preserved. | `src/cms/conf.py:68-164` | Every existing TOML section and key in the current config keeps its meaning. | P1 |
| REQ-F08 | Prisma remains the authority for tables; the schema is unchanged by this work. | `admin-panel/prisma/schema.prisma` | The model set is identical before and after; no migration is applied. | P0 |
| REQ-F09 | Large-object storage remains layout-compatible. | `admin-panel/src/lib/fsobjects.ts` | New code reads and writes the same digest-plus-large-object layout; existing files remain readable. | P0 |
| REQ-F10 | Feature parity is verified through the real user-facing path, not only unit tests. | Repository convention for verification | An end-to-end rehearsal of contest setup, submission, judging, and ranking succeeds on the replacement. | P0 |
| REQ-F11 | The participant experience is unchanged: training workflows for national and international olympiad preparation continue to feel the same. | `src/cms/server/contest/**`, `src/cmsranking/**` | A participant completes login, task viewing, submission, user tests, and question flow with no perceptible difference, confirmed by the operators. | P0 |
| REQ-F12 | Every replaced component is described with its current state, the improvement claimed, and the trade-off accepted. | This document set | `ARCHITECTURE.md` carries a per-component comparison row for every service and web server. | P1 |

## Delivery and process requirements

| ID | Requirement | Source | Acceptance criteria | Priority |
|---|---|---|---|---|
| REQ-P01 | Code follows the repository clean-code rules: no type suppression, functions at most about 40 lines, files at most about 250 lines, no unused imports. | Repository clean-code rules | Lint and review find no violation in new code. | P0 |
| REQ-P02 | Comments explain why, never what; no journal, phase, or status markers. | Repository clean-comment rules | Review finds no marker-style or narrated comments in new code. | P0 |
| REQ-P03 | Work is committed section by section; in-progress sections may use a work-in-progress prefix; no co-author trailer. | Repository commit convention | History shows one commit per completed section; no trailer line. | P1 |
| REQ-P04 | Commit subjects are short, imperative, and sentence case. | Repository commit convention | Subjects are at most about 50 characters; the body appears only when the reason is non-obvious. | P1 |
| REQ-P05 | Continuous integration gates every change: formatting, linting, build, and tests on both the Rust and TypeScript sides, plus the parity gates. | `.github/workflows/rust.yml:50-62`, `.github/workflows/lint.yml` | A change that fails any gate cannot merge. | P0 |
| REQ-P06 | API documentation is generated from the source of truth by a free and open-source generator. | Requirement for the replacement API | Generated reference is reproducible in CI and matches the running surface. | P2 |
| REQ-P07 | Every proposed dependency is free and open-source, with its cost tier stated; no paid dependency is proposed. | Standing constraint | Each proposal in `ARCHITECTURE.md` and `MIGRATION-OPTIONS.md` names a cost tier of free, paid-with-API, or paid-with-subscription, and none is paid. | P0 |

## Non-goals

| ID | Non-goal |
|---|---|
| NG-01 | This document set contains no Rust code, no TypeScript code, and no implementation. |
| NG-02 | No database schema change, migration, or `db push` is performed. |
| NG-03 | No dependency is added or installed. |
| NG-04 | No migration strategy is selected; all viable options are presented for a human decision. |
| NG-05 | The vendored Python under `src/` is not modified. |
| NG-06 | No performance target is asserted; no performance measurement exists in the repository today. |

## Reconciliation with the confirmed single-backend plan

A user-confirmed plan (`docs/PLAN-SINGLE-BACKEND.md`, audit at `docs/PHASE0-INVENTORY.md`) targets
the panel as the single write backend. The requirement set above assumes a Rust backend instead.
The two targets conflict; OQ-00 decides. The following requirements hold under either target and
should be treated as binding now, because they remove the divergences the confirmed plan exists to
eliminate.

| ID | Requirement | Source | Acceptance criteria | Priority |
|---|---|---|---|---|
| REQ-F13 | Security rules have exactly one source of truth and are generated into every other language, with a gate that fails on drift. | `docs/PLAN-SINGLE-BACKEND.md` decision 5; `docs/PHASE0-INVENTORY.md` finding 3 | A mismatch between a generated copy and the source fails the build. | P0 |
| REQ-F14 | No handler writes the database outside the single agreed write path, enforced by a gate. | `docs/PLAN-SINGLE-BACKEND.md`, drift-gate stage | A handler that writes directly fails the drift gate. | P0 |
| REQ-F15 | `all:all` expands identically everywhere; the two current Python predicates are unified. | `docs/PHASE0-INVENTORY.md` finding 3.2 | One expansion rule; a test fails on divergence. | P0 |
| REQ-F16 | Field-level permission rules exist in exactly one place, not three conflicting copies. | `docs/PHASE0-INVENTORY.md` finding 3.4 | The copies collapse to one; a test proves parity. | P1 |
| REQ-F17 | The Python-side audit gap is closed: today the audit model has no writer, so Python mutations are unrecorded. | `docs/PHASE0-INVENTORY.md` finding 2 | Every mutating Python path writes an audit entry before the change commits. | P1 |
