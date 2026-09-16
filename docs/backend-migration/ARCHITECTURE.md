# Architecture

This document proposes a target architecture. It is one candidate shape, not a decision; the
strategies that reach for it, and the option of not building it at all, are in
`MIGRATION-OPTIONS.md`. Every proposal here is a free and open-source dependency; cost tiers are
stated in section 6.

## 1. Scope of this architecture

The user asked for a comparison of components rather than a single scope. This architecture
therefore specifies the **full-replacement** workspace, and section 5 shows how the smaller scopes
described in `MIGRATION-OPTIONS.md` are strict subsets of it. No scope is selected here.

## 2. Workspace and crate boundaries

A single Cargo workspace, one binary per service, with shared crates. Crates are split so that a
dependency direction is never circular and so the wire protocol is defined once.

| Crate | Responsibility | Depends on |
|---|---|---|
| `cms-proto` | Wire types and the RPC envelope (`__id`, `__method`, `__data`, `__error`, `__secret`), the 1 MiB frame codec, and the config schema | serde |
| `cms-rpc` | Transport: CRLF-framed JSON over TCP, per-connection task, shared-secret verification that fails closed | `cms-proto`, tokio, hmac, subtle |
| `cms-db` | Data access over `sqlx`, using the application connection so row-level security stays binding | sqlx, `cms-proto` |
| `cms-sandbox` | Sandbox abstraction and the isolating backend; refuses to select a non-isolating sandbox for contestant code | `cms-proto` |
| `cms-grading` | Job model, scoring, language and task-type registry | `cms-db`, `cms-sandbox` |
| `cms-svc-evaluation` | Evaluation queue, fairness, worker registry | `cms-rpc`, `cms-db`, `cms-grading` |
| `cms-svc-worker` | Executes job groups in the sandbox | `cms-rpc`, `cms-sandbox` |
| `cms-svc-resource` | Resource telemetry, service control | `cms-rpc`, `cms-db` |
| `cms-svc-log` | Central logging | `cms-rpc`, `cms-db` |
| `cms-svc-proxy` | Forwards results to ranking servers | `cms-rpc`, `cms-db` |
| `cms-svc-scoring` | Score computation and invalidation | `cms-rpc`, `cms-db`, `cms-grading` |
| `cms-checker` | Output validation | `cms-grading` |
| `cms-api` | HTTP/JSON API for the admin panel; the single backend the panel calls | `cms-db`, `cms-rpc` |
| `cms-web-contest` | Participant-facing contest surface | `cms-db`, `cms-rpc` |
| `cms-web-ranking` | Ranking surface and event stream | `cms-db` |
| `cms-cli` | Operator CLI, delegating to the existing launcher and Makefile | process execution |

The non-isolating sandbox path (`src/cms/grading/Sandbox.py:563`) has no counterpart in
`cms-sandbox`; the crate exposes only isolation-capable backends.

## 3. API surface

The internal transport is preserved so a phased move is possible (REQ-F06). The panel-facing
surface is new and replaces direct database access.

| Surface | Shape | Notes |
|---|---|---|
| Internal service RPC | CRLF-framed JSON over TCP with `__secret`, identical field names to today | Preserves `src/cms/io/rpc.py` framing, the 1 MiB cap, and the fail-closed check. |
| Admin panel API | HTTP/JSON under a single base path, resource-shaped like the current 28 handlers | One API module in the panel; no server component and no server action reaches the database. |
| Contest surface | HTTP, routes identical to `src/cms/server/contest/handlers/__init__.py:65-107` | Preserves participant behaviour (REQ-F01). |
| Ranking surface | HTTP, routes identical to `src/cmsranking/RankingWebServer.py:83-88`, `:506-511` | Preserves scores, history, events (REQ-F02). |
| Documentation | Generated from the API definitions by `utoipa` | Satisfies REQ-P06 without a paid generator. |

## 4. Invariant preservation

Every invariant the task requires to be preserved, and its fate in this architecture.

| Invariant | Current source | Fate |
|---|---|---|
| `audit_log` append-only | `admin-panel/prisma/sql/20260820130000_rls.sql:218-223` | Preserved. No migration changes RLS; the API writes through the same policies; no UPDATE or DELETE path is added. |
| `submissions` DELETE allowed, governed by permission + reason + audit | `admin-panel/prisma/sql/20260820130000_rls.sql:227-236` | Preserved. The API enforces the reason and writes the audit entry before the delete commits. |
| `cms_backup` keeps BYPASSRLS and membership | `admin-panel/prisma/sql/20260820120000_db_roles.sql:15-52` | Preserved. No role SQL is touched. |
| Application role stays demoted | `admin-panel/prisma/sql/20260820140000_owner_hardening.sql` | Preserved. The new backend connects with the same role and never requests elevation. |
| RLS binds the application connection | `admin-panel/prisma/sql/20260820130000_rls.sql` | Preserved and reinforced: all new data access goes through `cms-db` on the application connection; no superuser or BYPASSRLS connection is introduced for request handling. |
| RPC message cap | `src/cms/io/rpc.py:117` | Preserved, same value. |
| RPC fail-closed authentication | `src/cms/io/rpc.py:62-74` | Preserved; the replacement keeps the same check and adds a per-caller identity as an unselected option (see `OPEN-QUESTIONS.md`). |
| Prisma is the table authority | `admin-panel/prisma/schema.prisma` | Preserved. The replacement treats the schema as read-only and adds no migration. |
| Large-object layout | `admin-panel/src/lib/fsobjects.ts` | Preserved; new code reads and writes the same digest-plus-large-object layout. |

## 5. Per-component comparison

Each row states the current state, the change proposed, the improvement claimed, the trade-off
accepted, and the effect on participants. This is the comparison the user asked for; it is not a
recommendation.

| Component | Current | Proposed | Improvement claimed | Trade-off | Participant impact |
|---|---|---|---|---|---|
| Evaluation service | Python, gevent, `EvaluationService.py` | Rust binary, same RPC methods | Uniform failure handling; a typed queue model | Loses upstream mergeability for this service | None if parity holds |
| Worker | Python, `Worker.py`, sandbox via isolate | Rust orchestrator calling the same isolate backend | Smaller attack surface around untrusted code | Must re-verify isolation equivalence | None if scheduling parity holds |
| Resource service | Python, `ResourceService.py` | Rust binary | Consistent telemetry shape | Small service; effort may exceed benefit | None |
| Log service | Python, `LogService.py` | Rust binary | Structured logging throughout | Low value if the rest stays Python | None |
| Proxy service | Python, `ProxyService.py` | Rust binary | Bounded outbound calls | Must reproduce retry and ranking semantics exactly | Indirect, via ranking freshness |
| Scoring service | Python, `ScoringService.py` | Rust binary | Deterministic score recomputation | Scoring rules are subtle; parity risk | Indirect, via scores |
| Checker | Python, `Checker.py` | Rust binary | Uniform resource limits | None material | None |
| Contest web server | Python, Tornado, 27 routes | Rust HTTP server, same routes | One language for the participant surface | Highest-risk rewrite; any drift is participant-visible | Direct; must be imperceptible |
| Ranking web server | Python, Tornado | Rust HTTP server | Same event stream, typed | Same participant-visibility risk | Direct |
| Admin web server | Python, 75 routes | Rust HTTP server | Consolidation | Large surface to reproduce | None |
| Admin panel | Next.js, direct Prisma and Docker socket | TypeScript frontend plus one `api/` module calling the Rust API | Removes backend logic and database credentials from the panel | Panel loses direct container control; only if the API exposes it safely | None |
| Operational CLI | Rust `cms-tui` over the bash launcher | Unchanged, or extended to call the new API | Already Rust | None | None |

## 6. Proposed dependencies and cost tiers

Every entry is free and open-source. No paid dependency is proposed anywhere.

| Dependency | Purpose | License | Cost tier |
|---|---|---|---|
| tokio | Async runtime | MIT | Free |
| axum | HTTP API framework | MIT | Free |
| serde / serde_json | Serialization | MIT or Apache-2.0 | Free |
| sqlx | Database access with bound parameters | MIT or Apache-2.0 | Free |
| hmac / subtle | Constant-time secret comparison | MIT or Apache-2.0 | Free |
| clap | CLI parsing, already in use | MIT or Apache-2.0 | Free |
| tracing | Structured logging | MIT | Free |
| utoipa | Generated API documentation | Apache-2.0 | Free |
| rustls | TLS for outbound calls | Apache-2.0 or ISC | Free |
| isolate | Sandbox backend, already in use | GPL-2.0 | Free |

## 7. What this architecture does not claim

- It does not claim any performance improvement; no performance measurement exists today.
- It does not claim that parity is proven by construction; parity is a verification obligation
  (REQ-F10, REQ-F11).
- It does not decide whether to build it; that is `MIGRATION-OPTIONS.md`.

## 8. Relationship to the confirmed single-backend plan

A user-confirmed plan on this branch (`docs/PLAN-SINGLE-BACKEND.md`) makes the Next.js panel the
only write backend and turns the Python admin into a client of the panel API. Its audit
(`docs/PHASE0-INVENTORY.md`) finds 55 mutating handlers, 95 permission guards, 147 panel server
actions that write Prisma directly, and 10 field-permission divergences between the two UIs.

This architecture supersedes that end-state only if the Rust task is chosen. The two can be
sequenced rather than opposed: the confirmed plan consolidates writes into one service layer (its
first stage, already underway in the branch history), and a Rust backend can later replace that layer,
with the panel's `api/` module retargeted from the panel's own routes to the Rust API. Under that
reading the panel's service layer is throwaway scaffolding, not the final home of the logic — a
cost that should be weighed explicitly. The reconciling requirements are REQ-F13 to REQ-F17; the
decision is OQ-00.
