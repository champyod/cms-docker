# Rust Ranking Web Server — Design

**Date:** 2026-10-09
**Scope:** replace the Python ranking web server (src/cmsranking, 2 441 LOC) with a Rust service, and give the admin panel control of its appearance, its manual overrides and its login
**Branch:** feat/rust-ranking-server, own worktree cms-docker-ranking, cut from major/admin-panel at 25083a33
**Mode:** parity-gated replacement. Spec and plan are approved before code; every slice lands and is verified on its own
**Framing:** PARTS instructor prompt, approved 2026-10-09 (section 3)

---

## 1. Goal

Deliver a Rust ranking web server that:

1. serves the live scoreboard with the same routes, payloads and event stream the Python service serves today;
2. is operated entirely from the admin panel — appearance, columns, manual ranking overrides, access mode;
3. protects its console with the panel's login model: account, bcrypt, adaptive CAPTCHA, lockout, resolved against the same permission tables;
4. stores its data in PostgreSQL tables instead of the cms-ranking-data JSON store, so it follows the same database and rotation model as every other service;
5. removes the Python service from the runtime path without changing what a participant sees.

Claim that cannot be verified today: the repository asserts no performance property at all
(docs/backend-migration/REQUIREMENTS.md, NG-06 "no performance target is asserted; no performance
measurement exists"). "Fastest" is therefore a design intent and stays theory: you decided against a
benchmark gate, so no speed figure is claimed and no measurement is an acceptance criterion.

## 2. Verified baseline (2026-10-09)

### 2.1 The service today

| Fact | Evidence |
|---|---|
| Python package, 2 441 LOC | src/cmsranking/{RankingWebServer.py:735, Scoring.py:416, Store.py:336, Logger.py:266, Config.py:96, Subchange.py:93, Submission.py:81, Contest.py:79, User.py:75, Team.py:60, Task.py:107} |
| Entry point cmsRankingWebServer | src/setup.py (service scripts), scripts/__cmsRankingWebServer |
| Container cms-ranking-web-server, port 8890 | docker-compose.yml:541-583 ("Ranking Web Server - Live rankings display") |
| Config file config/cms_ranking.toml | docker-compose.yml:565; generated from config/cms.ranking.sample.toml by scripts/__config_sync.sh:1211-1212 |
| Data directory is a volume | cms-ranking-data mounted at /var/local/lib/cms/ranking, docker-compose.yml:567 and :475 (the panel mounts the same volume read-write for logo upload) |
| Store is files plus memory | src/cmsranking/Store.py (JSON per entity, RLock, callbacks); there is no database import in RankingWebServer.py |
| Login is one HTTP Basic pair | config/cms.ranking.toml keys username, password, realm_name; StoreHandler compares Basic credentials (RankingWebServer.py:75-140) |

### 2.2 Data flow today

The ranking server never reads PostgreSQL. ProxyService pushes every entity to it over HTTP:

| Fact | Evidence |
|---|---|
| Push target is a URL in the CMS config | config/cms.toml:167 rankings = ["http://admin:...@cms-ranking-web-server:8890/"] |
| Push is a PUT of a JSON body with Basic auth | src/cms/service/ProxyService.py:73-97 safe_put_data |
| One executor per ranking URL, retried | src/cms/service/ProxyService.py ProxyExecutor and ProxyService.__init__ |
| External tool exists for manual pushes | src/cmscontrib/RWSHelper.py (cmsRWSHelper) |

Consequence: the current freshness path is HTTP, not SQL. Section 4.4 states what changes.

### 2.3 Routes

| Group | Routes | Evidence |
|---|---|---|
| Data CRUD, Basic auth | GET/PUT/DELETE on / and /<key> per store | RankingWebServer.py:83-88, StoreHandler at :75 |
| Sublist | /<user_id> sublist | RankingWebServer.py:287 |
| Public | / , /history , /scores , /events , /logo , /config , /credits | RankingWebServer.py:534-543 RoutingHandler |

/credits is a fork addition (AGPL source offer) and takes its data from credits.json through
src/cms/server/credits.py.

### 2.4 The page

The scoreboard is vendored static jQuery, 5 155 LOC in src/cmsranking/static: Ranking.html:128,
Ranking.css:1171, DataStore.js:1209, Overview.js:596, Scoreboard.js:509, UserDetail.js:326,
HistoryStore.js:312, Chart.js:202, TeamSearch.js:198, TimeView.js:151, Config.js:96, Ranking.js:49.

Config.js fetches /config synchronously and assigns it over a two-key PublicConfig object, so every
appearance field the server already returns is reachable by the page without a rewrite. Today that
object carries only show_id_column and source_url (src/cmsranking/Config.py:41-51).

### 2.5 What the panel has today

| Surface | Evidence |
|---|---|
| Ranking page | admin-panel/src/app/[locale]/(authenticated)/ranking/page.tsx |
| Components | admin-panel/src/components/ranking/{RankingClient.tsx, BrandingCard.tsx, RankingConnectionCard.tsx, RankingScoreboard.tsx, useRankingRows.ts} |
| Ranking read action | admin-panel/src/app/actions/ranking.ts (getRanking, gate ranking:list) |
| API routes | admin-panel/src/app/api/ranking/{auth,logo,snapshot}/route.ts |
| Session that stores Basic credentials | admin-panel/src/lib/ranking-session.ts (encrypted cookie, 2 h) |
| Permission keys | ranking:list, ranking:read, ranking:snapshot, ranking:update (admin-panel/src/lib/permission-registry.ts:50,96); ranking:create and ranking:delete are reserved with the reason "Ranking rows are computed" (:215-216) |
| Nav node | infrastructure.ranking (admin-panel/src/lib/navigation/registry-platform.ts:19) |

So the panel today can connect, poll a snapshot and replace the logo. Appearance, columns, overrides
and access mode do not exist.

### 2.6 Rust and CI in this tree

| Fact | Evidence |
|---|---|
| One existing crate | tools/cms-tui/Cargo.toml, Cargo.lock, musl target pinned in .cargo/config.toml |
| CI rust gate | .github/workflows/ci.yml rust job: cargo fmt --check, clippy -D warnings, build, test; working-directory tools/cms-tui; own paths-filter |
| No ranking crate anywhere | only tools/cms-tui exists in this tree; cms-docker-rust/backend is a different branch's workspace |
| Dockerfile has no Rust build stage | Dockerfile installs Debian rustc in the package list only; the ranking image is built from the same Dockerfile as the core services |

### 2.7 Table and permission authorities

| Authority | Evidence |
|---|---|
| Prisma owns the panel schema, 36 models | admin-panel/prisma/schema.prisma |
| RLS coverage gate enumerates only the Prisma schema | scripts/__generate_rls_sql.sh:9 SCHEMA=admin-panel/prisma/schema.prisma; the gate reports 36 tables |
| Python owns the CMS schema, 32 mapped tables, created by cmsInitDB | src/cms/db/*.py; scripts/__cmsInitDB |
| Panel passwords are bcrypt with a kind prefix | admin-panel/src/lib/password-format.ts (bcrypt:<hash>, bcryptjs, 10 rounds); verification at admin-panel/src/app/actions/auth.ts:101 |
| Permission engine is TypeScript-only | admin-panel/src/lib/{permission-registry.ts, permission-groups.ts, permission-engine.ts} |
| Login CAPTCHA model | docs/LOGIN-CAPTCHA.md; panel implementation admin-panel/src/lib/captcha.ts (Turnstile default, hCaptcha, CAPTCHA_THRESHOLD 3, lockout 5, 15 min) |

## 3. Decisions (user-approved)

| Question | Decision |
|---|---|
| Deliverable | Spec + plan first, then implement on approval |
| Prompt framework | PARTS |
| Target | New branch off major/admin-panel, in its own worktree |
| Branch name | feat/rust-ranking-server |
| Isolation | New git worktree, so the 19 uncommitted files in cms-docker-major stay untouched |
| Scope of "whole replace" | Rust ranking server plus panel controls, shipped in slices |
| Auth | Two planes: machine credential for pushes, session login with adaptive CAPTCHA for humans |
| Data source | ProxyService writes the new tables directly; the ranking server reads them; the JSON file store is retired |
| Rotation | Same as every service: read the database from the environment, rotate by rename + repoint + config sync + redeploy |
| Appearance | Title/subtitle/organisation, logo and favicon, theme colours, columns and visibility, score format, footer/source/credits text |
| Credits | Compact editable default text plus a short hardcoded credit line; not the current full-page credit sheet |
| Overrides | Hide/show a row, add a guest row, pin a rank, rename a display name, override a displayed score |
| Push compatibility | Retired at once, not kept behind a flag: development pushes are not in use, so the HTTP push contract and cmsRWSHelper go with the file store |
| Access control | A login toggle the panel controls (public or login-required); lockout viewing and unblocking live in the panel |
| CAPTCHA source | All CAPTCHA keys stay in config.toml and are never edited from the panel |
| Performance evidence | Theory only: no benchmark gate, no published speed figure |
| Commit discipline | Sectional commits, clean code, why-not-what comments, Conventional Commits |

## 4. Architecture

### 4.1 Crate and stack

One new crate, tools/cms-ranking, a workspace member beside tools/cms-tui, so the existing rust CI
job and its musl convention extend to it instead of inventing a second Rust home.

| Choice | Version basis | Why |
|---|---|---|
| axum + tokio | vetted in docs/backend-migration/ARCHITECTURE.md section 6.1 (axum 0.8.9 keep, actix-web reject, hyper reject-as-direct) | tower middleware composes auth, timeout and tracing; SSE is built in |
| sqlx, postgres, runtime-tokio, tls-rustls-ring-webpki | the version the other Rust tree already locks (0.9.0) | one query layer; RLS stays binding because the service uses the application connection |
| serde, serde_json, chrono, thiserror | same table | wire types and config |
| bcrypt | matches admin-panel bcryptjs format (bcrypt:<hash>, 10 rounds) | the Rust service verifies the same stored hashes the panel does |
| hyper client or reqwest for siteverify | CAPTCHA verification is one outbound POST | see section 5.3 |

### 4.2 Data model (proposed — confirm before slice 2)

Two table families, both Prisma models, both RLS-covered, because the panel is the editor and the
RLS gate plus the Prisma client both read that schema.

Family A — the pushed store, one table per entity kind, mirroring src/cmsranking/{User,Team,Task,
Contest,Submission,Subchange}.py so the wire payloads and the consistency checks keep their meaning.
Columns are typed rather than a jsonb document per row, because /scores and /history aggregate over
user, task and time and those must be indexable columns. The wire field order is stored as
display_order, since order is a reserved word in SQL. No foreign keys are declared: the pusher
writes kinds in dependency order and the Python store dropped a dangling reference rather than
failing the write, so a constraint would turn a push-order slip into a lost submission.

    ranking_contests(key pk, name, begin, end, score_precision, updated_at)
    ranking_tasks(key pk, name, short_name, contest, max_score, score_precision,
                  extra_headers jsonb, display_order, score_mode, updated_at)
    ranking_teams(key pk, name, updated_at)     ranking_users(key pk, f_name, l_name, team, updated_at)
    ranking_submissions(...) ranking_subchanges(...)

Family B — the panel-owned control tables:

    ranking_settings(id, title, subtitle, organisation, logo_asset, favicon_asset,
                     theme jsonb, columns jsonb, score_format jsonb,
                     footer_text, credits_text, access_mode, updated_at, updated_by)
    ranking_overrides(id, contest_id, target_kind, target_key, action, payload jsonb,
                      reason, active, created_at, created_by, ended_at, ended_by)

Family A carries the pushed data only; Family B carries everything the panel decides. A single
generated DDL pass adds the RLS enable/force statements, and the backup table catalog test gains
the new models exactly as it gained security_blocks.

### 4.3 Read and event path

The service keeps the existing public surface: / (page), /history, /scores, /events, /logo,
/config, /credits, plus the Basic-authenticated CRUD used by cmsRWSHelper during the transition.

/events stays server-sent events with the same event names; a change to ranking_settings or
ranking_overrides must reach connected browsers without a reload. Proposed mechanism: LISTEN/NOTIFY
on two trigger channels with a 5 s poll fallback, chosen over polling alone because the override
list is small and changes rarely but must appear immediately.

### 4.4 Push path change

ProxyService stops calling safe_put_data against a ranking URL and writes Family A rows instead
(parameterised SQL, RLS-bound application role). Consequences that must be accepted explicitly:

- the vendored Python under src/ gains a fourth patched area (CONTEXT.md lists three today), so an
  upstream sync conflicts here forever;
The HTTP push contract is retired in the same slice rather than kept behind a flag, because no push is
in use during development: the Basic-authenticated CRUD routes, cmsRWSHelper and the panel's
ranking-session Basic cookie all go with the file store.

Consequences accepted explicitly:

- the retry queue inside ProxyService is rewritten against SQL, so its failure semantics change from an
  HTTP status to a database error and must be covered by tests;
- a rollback to the Python service is a code revert, not a configuration flag.

### 4.5 Rotation

No new mechanism. The service reads the same database credentials the panel and the core services
read from the generated .env, so ./cms db rename + repointing every [db_<profile>] POSTGRES_DB +
./cms config sync + redeploy behaves exactly as docs/DB-ROTATION.md section 5 describes. The plan
adds one pass-criterion line for ranking to that document, because the service is now a database
client and a skipped repoint would otherwise look like a ranking outage rather than a stale name.

## 5. Authentication and authorization

### 5.1 Two planes

| Plane | Caller | Credential | Surface |
|---|---|---|---|
| Machine | ProxyService, cmsRWSHelper | a single provisioned token from config.toml, compared in constant time | the data CRUD routes only |
| Human | an operator in a browser | the panel account model: bcrypt password, adaptive CAPTCHA, lockout, HTTP-only session cookie | appearance, overrides, access mode |

A CAPTCHA cannot be solved by a robot, so separating the planes is what makes "protected login like
the admin panel" compatible with a machine that must keep pushing data.

### 5.2 Accounts and permissions (proposed)

The Rust service verifies admins.authentication with bcrypt against the same table the panel uses,
and resolves the ranking key subset of the permission tables (groups, per-admin overrides, deny-wins,
all:all expansion). To satisfy REQ-F13 (one source of truth, generated, drift-gated) the key subset
is generated from admin-panel/src/lib/permission-registry.ts into the Rust crate and the CI gate fails
on mismatch. New keys proposed: ranking:appearance, ranking:override, ranking:access, one verb per
control surface, added to the registry and to the groups that already hold ranking:read.

### 5.3 CAPTCHA and lockout

Reused provider settings, not new ones: CAPTCHA_ENABLED, CAPTCHA_PROVIDER, CAPTCHA_SITE_KEY,
CAPTCHA_SECRET_KEY, CAPTCHA_THRESHOLD, CAPTCHA_BAN_THRESHOLD, exactly as docs/LOGIN-CAPTCHA.md
documents. config.toml is the only source for all six, as you decided: the panel never edits them, and
the service reads them from the ranking configuration that ./cms config sync generates. The service
verifies the token itself against the provider siteverify endpoint, matching the existing decision that
a Tornado server does not call the panel for this (docs/LOGIN-CAPTCHA.md section 2b), and applies the
same 5-failure lockout and 429 with Retry-After.

The login requirement itself is a panel toggle, not a config key: ranking_settings.access_mode selects
public or login-required for the whole scoreboard. Lockout counters stay in memory per process, as they
are in the panel, and the panel gains the unblock path, because an operator otherwise has to restart a
process to clear a failed counter.

## 6. Appearance and credits

All six approved appearance groups are stored in ranking_settings and published through /config, so
the vendored page picks them up without a rewrite: the page already reads /config into PublicConfig
(section 2.4). Theme is emitted as CSS custom properties on the served document, which requires a
small patch to Ranking.css and Ranking.html rather than a new frontend.

Credits change shape as you asked, in two places: the footer (Ranking.html LicenseNotice) shows
compact editable text, and /credits keeps the full credit list, which also becomes editable from the
panel. A short AGPL source-offer line stays hardcoded and cannot be edited away, because section 13 of
the licence requires the running deployment to name its own source. Editable fields are stored as
structured values in ranking_settings, never as raw HTML, so an unauthenticated page cannot be turned
into a stored-XSS vector.

## 7. Manual overrides

Every override is a row in ranking_overrides with the action, who set it, when, and a reason, which
makes the pair (hide/show, pin, rename, score override, guest row) auditable and reversible. The
service applies them after scoring and before serialisation, so one row can never change a stored
score (append-only submissions stay append-only; the contest database is not touched). The panel
gains a permissioned editor for that table; removing an override ends the row rather than deleting it.

## 8. Deployment and cutover

1. the ranking-web-server compose service keeps its name, port and healthcheck, and its command
   changes from cmsRankingWebServer to the Rust binary;
2. the Dockerfile gains a Rust build stage; the Debian rustc already in the package list is not a
   build toolchain and must not be used;
3. cms-ranking-data is retired for data and kept only if the logo stays file-backed; the ADR
   docs/decisions/ranking-logo-storage.md is superseded by this decision and must be amended, not
   silently contradicted;
4. the Python command stays installed until the parity gate passes, then is removed from the runtime
   path; removal from src/setup.py is a separate, approved step.

## 9. Verification

| Gate | What it proves |
|---|---|
| Golden response parity | /, /scores, /history, /config, /logo, /events against fixtures captured from the Python service before the cutover |
| Rust gates | cargo fmt --check, clippy -D warnings, cargo test, and a container smoke test of the built image |
| Panel gates | tsc --noEmit, vitest, plus the existing permission, RLS and backup-catalog tests, which must be updated, not bypassed |
| Permission drift gate | generated Rust key subset equals the TypeScript registry |
| Rotation rehearsal | rename + repoint + config sync + redeploy per docs/DB-ROTATION.md, with ranking in the pass criteria |
| End-to-end rehearsal | contest setup, submission, judging, ranking per REQ-F10, on the replacement |

## 10. Risks and accepted costs

| Risk | Cost | Mitigation |
|---|---|---|
| Upstream mergeability | A fourth patched Python area (ProxyService) | accept explicitly, as CONTEXT.md already does for the other three |
| Participant-visible drift | The scoreboard is what the audience watches | golden parity plus the end-to-end rehearsal before cutover |
| No HTTP push path after the cutover | A rollback is a code revert, not a flag | accepted by decision; the parity fixtures make the revert a known quantity |
| No performance data | "Fastest" cannot be claimed or checked | accepted: the claim stays theory and no measurement is an acceptance criterion |
| Lockout is per process | A restart clears counters, as today | same limitation as the panel, documented |

## 11. Resolved questions (2026-10-09)

| Question | Decision |
|---|---|
| Benchmark gate | No measured gate. The speed claim stays theory; no figure is published. |
| Push compatibility | Retired at once with the file store; development pushes are not in use. |
| Table shape | One table per entity kind, mirroring the entity classes. |
| /credits | The full credit list stays on the route and becomes editable; the footer carries the compact editable text. |
| Access mode | A login toggle the panel controls; CAPTCHA keys stay in config.toml and are never panel-edited. |
| Logo storage | Keep the volume plus host mirror; docs/decisions/ranking-logo-storage.md stands. |

Also confirmed for this work: sectional commits, clean code, why-not-what comments, Conventional
Commits throughout.

## Appendix A — Alternatives considered (five per decision area)

### A.1 Language and timing

| Alternative | Why not chosen |
|---|---|
| Keep Python and optimise it (the opposing stance) | No measurement exists to show Python is the bottleneck (NG-06), so this is a legitimate counter-position; the request is explicit, and the parity harness this spec requires is what makes either answer checkable |
| Port only the hot path and keep Tornado | Two runtimes for one surface doubles the deployment and the parity surface |
| Use cms-docker-rust/backend as the home | That workspace belongs to a different branch and a different analysis; worktree drift would fork the crate |
| Write it as a separate repository | Loses the existing rust CI job and the musl packaging convention |
| Defer until the single-backend plan finishes | The confirmed plan (docs/PLAN-SINGLE-BACKEND.md) targets a different end state and is still in flight; deferring leaves the ranking service on the file store |

### A.2 HTTP stack

| Alternative | Why not chosen |
|---|---|
| actix-web | Rejected in the vetted dependency table (ARCHITECTURE.md 6.1): incompatible middleware model, higher MSRV |
| hyper directly | Re-implements routing and extractors axum already provides |
| A blocking stack (tiny_http) | The service is concurrent and SSE-driven; blocking threads fight the event stream |
| tonic/gRPC | The clients are browsers and a Python pusher; the wire format is HTTP/JSON |
| Rewrite the Python service in Rust but keep its WSGI middleware shape | Rust has no WSGI; the middleware equivalent is tower |

### A.3 Storage

| Alternative | Why not chosen |
|---|---|
| Keep the JSON file store (opposing stance) | It is what you asked to replace, it cannot be queried or RLS-gated, and it does not follow database rotation |
| One ranking_entities table with a kind discriminator | Fewer migrations, but it hides the entity shape from the type system and weakens the RLS and catalog gates |
| SQLAlchemy models in src/cms/db plus cmsInitDB | Creates a second schema authority; the RLS gate enumerates only the Prisma schema |
| Redis or another in-memory store | A second stateful service to back up and rotate for data that changes a few times per contest |
| Materialise Family A into the panel's own tables and read those | Duplicates the push pipeline and adds a delay between an accepted submission and its row |

### A.4 Auth

| Alternative | Why not chosen |
|---|---|
| Keep HTTP Basic for humans (opposing stance) | It cannot carry a CAPTCHA, has no lockout, and the current panel already stores the Basic pair in a cookie to work around it |
| Panel acts as an SSO broker for the ranking console | Adds a network hop on the login path; the repository already rejected that shape for captcha verification (docs/LOGIN-CAPTCHA.md 2b) |
| A separate ranking credential table | A second set of accounts to provision, rotate and audit, diverging from the panel RBAC you asked to reuse |
| Reimplement the full permission engine in Rust | The full engine has 220 keys and all:all expansion; only the ranking subset is needed, and generation keeps it honest |
| Gate by IP or network only | Not an account model; fails the "like admin-panel" requirement |

### A.5 Appearance

| Alternative | Why not chosen |
|---|---|
| Rewrite the frontend in Rust or React (opposing stance) | 5 155 LOC of vendored JS already reads /config; a rewrite multiplies participant-visible risk for no feature the config cannot carry |
| Put appearance in config.toml only | A change would need config sync plus a restart, which is not panel control |
| Serve a theme per contest rather than per deployment | The scoreboard has no contest selector for appearance today; per-contest theming needs a routing change first |
| Editable free-form HTML/CSS blocks | Stored XSS on an unauthenticated page; the settings must stay structured values |
| Keep the full credit sheet and only retitle it | That is the "one and a half screens" shape you rejected |

### A.6 Overrides

| Alternative | Why not chosen |
|---|---|
| Edit the contest database instead of an overlay | Breaks append-only submissions and the RLS/audit invariants |
| Keep overrides in a JSON file in the ranking volume (the accepted logo ADR pattern) | No per-operator audit, no RLS, and no way to query who hid a row |
| Apply overrides in the browser only | Every viewer would need the override set and could bypass it |
| Hard-delete the overridden row | Loses the audit trail and makes an accidental hide unrecoverable |
| Let an override change the stored score | Scoring must stay reproducible from the submission history |
