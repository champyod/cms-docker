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
| `audit_log` append-only | `admin-panel/prisma/migrations/20260912000400_rls_policies/migration.sql:153-158` | Preserved. No migration changes RLS; the API writes through the same policies; no UPDATE or DELETE path is added. |
| `submissions` DELETE allowed, governed by permission + reason + audit | `admin-panel/prisma/migrations/20260912000400_rls_policies/migration.sql:163-171` | Preserved. The API enforces the reason and writes the audit entry before the delete commits. |
| `cms_backup` keeps BYPASSRLS and membership | `admin-panel/prisma/sql/20260820120000_db_roles.sql:15-52` (intentionally exempt: role SQL lives only here, not as a migration) | Preserved. No role SQL is touched. |
| Application role stays demoted | `admin-panel/prisma/migrations/20260912000500_owner_hardening/migration.sql:17` | Preserved. The new backend connects with the same role and never requests elevation. |
| RLS binds the application connection | `admin-panel/prisma/migrations/20260912000400_rls_policies/migration.sql` | Preserved and reinforced: all new data access goes through `cms-db` on the application connection; no superuser or BYPASSRLS connection is introduced for request handling. |
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

## 6. Proposed dependencies, versions, and cost tiers

Every entry is free and open-source. No paid dependency is proposed anywhere.
Every cost tier is therefore "Free"; the column that actually decides an entry
is disposition.

Versions were read on 2026-09-26. Two provenance markers are used:

- `lock` — the version `backend/Cargo.lock` resolves today.
- `index` — read from the crates.io index, and the newest release there on that
  date. Publish dates are given so a later reader can tell how current a row was.

A `lock` row is a statement about this tree. An `index` row is a statement about
the registry. Neither is a performance claim; see 6.7.

### 6.1 Runtime and HTTP

| Dependency | Version | Source | License | Disposition | Trade-off |
|---|---|---|---|---|---|
| tokio | 1.53.1 | lock | MIT | keep | Required because the services are network servers and `sqlx` is configured `runtime-tokio`. The cost is a large dependency surface that buys the synchronous operator CLI nothing. |
| axum | 0.8.9 | index, published 2026-04-14 | MIT | keep | Middleware is `tower::Service`, so timeouts, tracing, and auth layers compose instead of being hand-written, and `axum-core` is the stable surface for the shared types. The cost is that axum targets tokio and hyper specifically and states that runtime independence is not a goal; its default `tokio` feature pulls the runtime into every consumer. |
| actix-web | 4.15.0 | index, published 2026-08-21 | MIT or Apache-2.0 | reject | Carries its own router and middleware type, so middleware cannot be shared with the tower stack the rest of the workspace would use, and it raises the MSRV to 1.88 against axum's 1.80. Rejecting it means giving up the throughput argument usually made for actix; no measurement here supports or refutes that argument. |
| hyper | 1.11.1 | index, published 2026-08-28 | MIT | reject as a direct dependency, keep transitively | Writing routing, extractors, and body handling directly on hyper re-implements what axum provides. axum 0.8.9 requires `hyper ^1.1.0`, so 1.11.1 is what lands in the tree regardless. |

### 6.2 Database

| Dependency | Version | Source | License | Disposition | Trade-off |
|---|---|---|---|---|---|
| sqlx | 0.9.0 | lock, and the requirement in `backend/Cargo.toml` | MIT or Apache-2.0 | keep | The only option that can offer compile-time checked queries via optional macros against a real database; the current manifest disables `macros`, so that cost is not currently incurred. RLS also stays binding, because all access goes through the application connection. The cost when macros are enabled is that compile-time checking ties a build to a reachable database or a checked-in query cache, and `tls-rustls-ring-webpki` is a narrower TLS story than a native-tls build. |
| tokio-postgres | 0.7.18 | index, published 2026-06-12 | MIT or Apache-2.0 | reject | A plain async driver with no compile-time verification, so a renamed column or a changed type surfaces at runtime. Its `runtime` feature does enable tokio net and time, so it is a workable peer. Rejecting it means hand-written row decoding is maintained for every query the checked layer would otherwise cover. |
| diesel | 2.3.13 | index, published 2026-09-04 | MIT or Apache-2.0 | reject | The `postgres` feature pulls `pq-sys`, a libpq C binding, which would add a C dependency and change the build and packaging story. Its published 2.3.13 feature set also exposes no async feature, so using it inside tokio handlers means a blocking pool. Rejecting it means the query layer stays thinner but gains no query-level type checking. |
| sea-orm | 2.0.3 | index, published 2026-09-13 | MIT or Apache-2.0 | reject | An ORM built on sqlx, so adopting it means adopting sqlx anyway plus a second abstraction, at the highest MSRV in this section (1.94.0). Its `schema-sync` feature pulls in schema tooling meant to generate DDL; leaving that feature off is required, because Prisma remains the table authority and no migration may be introduced. Rejecting it means query shapes are written by hand with no entity-level codegen. |

### 6.3 Serialization, errors, config, and CLI

| Dependency | Version | Source | License | Disposition | Trade-off |
|---|---|---|---|---|---|
| serde | 1.0.229 | lock | MIT or Apache-2.0 | keep | Derive support for the wire types and the config schema. |
| serde_json | 1.0.151 | lock | MIT or Apache-2.0 | keep | `arbitrary_precision` is already enabled in `backend/Cargo.toml`, so a JSON number crossing the RPC boundary keeps its literal form instead of being reformatted through a float. The cost is that arbitrary-precision parsing is slower than the default path; no figure for that is claimed. |
| thiserror | 2.0.21 | lock, and the index newest on 2026-09-26 | MIT or Apache-2.0 | keep | Derive-only, so the library error enums are concise while the top-level binary entry point still needs a second error type for context. `anyhow` is not in the current manifest and is not proposed here. |
| toml | 1.1.6 | index, published 2026-09-10 | MIT or Apache-2.0 | keep | `cms-proto` owns the config schema. The index version string carries the suffix `+spec-1.1.0`, so the requirement is `1.1.6`; `toml` is absent from backend lock, no lock metadata claimed. No API-compatibility claim is made: the existing parser is small and must be re-verified against 1.1.6 before the version is adopted. |
| clap | 4.6.7 | index, published 2026-09-14 | MIT or Apache-2.0 | keep | `cms-cli` parses the operator CLI and then delegates to the existing launcher and Makefile, so its flags must match what operators already type. The `derive` feature is what the operator tool already uses. |

### 6.4 Observability, secret handling, TLS, and documentation

| Dependency | Version | Source | License | Disposition | Trade-off |
|---|---|---|---|---|---|
| tracing | 0.1.44 | lock | MIT | keep | Structured logs throughout. axum's `tracing` feature emits rejections from its built-in extractors with no extra wiring. |
| hmac / subtle | 0.13.0 / 2.6.1 | lock | MIT or Apache-2.0 | keep | The fail-closed secret check on every RPC frame, with `subtle` supplying the constant-time comparison. This is the security-critical pair and gets no substitution. |
| rustls | 0.23.45 | lock | Apache-2.0 or ISC | keep | Matches the `tls-rustls-ring-webpki` feature already chosen for sqlx, so the tree carries one TLS stack rather than two. The cost is that the provider is `ring`; a policy requiring FIPS-validated providers would force the `aws-lc-rs` feature and a rebuild. |
| utoipa | 6.0.0 | index, published 2026-09-22 | MIT or Apache-2.0 | keep | Generates OpenAPI at compile time, satisfying the documentation requirement with no paid generator. It exposes an `axum_extras` feature, which is the integration point if the API is axum. The cost is that 6.0.0 is a recent major, so its derive macros must be reviewed against the API definitions. |
| bollard | 0.21.1 | index, published 2026-08-16 | Apache-2.0 | keep, scoped to container control | Section 5 records that the admin panel loses direct container control. The resource service and the panel's `api/` module are what give it back, and this is the async Docker client that fits a tokio service. The default feature set is `http` and `pipe`; a TLS-protected daemon endpoint needs `ssl` enabled explicitly. The crate is versioned independently of the Docker API it wraps, so an API change is a maintenance obligation rather than a one-time port. |

### 6.5 Sandbox

| Dependency | Version | Source | License | Disposition | Trade-off |
|---|---|---|---|---|---|
| isolate | not versioned as a crate | the sandbox backend already in use | GPL-2.0 | keep, unchanged | No version applies, so none is proposed. It remains the one entry here that is not MIT or Apache-2.0, and its copyleft obligation is unchanged by this re-baseline, as is the obligation to re-verify isolation equivalence before trusting the worker port. |

### 6.6 Disposition summary

Keep: tokio, axum, hyper (transitively), sqlx, serde, serde_json, thiserror,
toml, clap, tracing, hmac, subtle, rustls, utoipa, bollard, isolate.

Reject: actix-web, tokio-postgres, diesel, sea-orm, and hyper as a direct
dependency.

Nothing in this section is rejected for being slow or fast. Each rejection rests
on a structural property — a C dependency, a second abstraction over a crate
already chosen, a middleware stack that cannot be shared, no compile-time query
checking — that is visible in the crate's own feature and version metadata.

### 6.7 Benchmarks

No benchmark was run for this re-baseline. No throughput, latency, memory, or
binary-size figure is claimed for any version in this section, and none can be
inferred from the version numbers. Any performance claim would need a
measurement against the Python services it would replace, on this system's own
data volume, and that measurement does not exist. Section 7 already disclaims
performance improvement; this subsection records that choosing between the
versions above adds no measurement either.

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
