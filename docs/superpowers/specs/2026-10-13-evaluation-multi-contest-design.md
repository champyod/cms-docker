# Evaluation Multi-Contest Wiring — Design

**Date:** 2026-10-13
**Scope:** let one deployment run N contests at once; let the evaluation service be wired to one contest or many; expose each contest through the domain front and Tailscale at its own address; let the database author every binding and apply it without hand-editing host config
**Branch:** cms-hub/evaluation-multi-contest, own worktree cms-hub/evaluation-multi-contest, cut from major/admin-panel at a093b003
**Mode:** decisions settled. Sections 3 and 4 are confirmed; section 5 flags the one thing inferred rather than answered
**Framing:** user-zero-trust two-gate. Both rounds answered 2026-10-13

---

## 1. Goal

1. One host runs contest 1 *and* contest 2 *and* contest 3 concurrently — today it serves exactly one.
2. The evaluation service serves **one contest or all of them**, selectable, without a code fork between the two modes.
3. Each contest is reachable at its own address: its own hostname, its own subdomain, its own path prefix, or its own tailnet name.
4. Every binding lives in the database and is hot-applied; the host holds less configuration than it does now, not more.
5. No legacy path breaks: `make contest`, `./cms contest set-active`, and `CONTEST_ID` keep working.

## 2. Verified baseline (2026-10-13, major/admin-panel @ a093b003)

### 2.1 The service registry is shard-indexed

| Fact | Evidence |
|---|---|
| Every service class is a list of `[host, port]`; list position **is** the shard | `config/cms.sample.toml:38-53` |
| `EvaluationService = [["cms-evaluation-service", 25000]]` | `config/cms.sample.toml:42` |
| `ContestWebServer = [["cms-contest-web-server", 21000]]` | `config/cms.sample.toml:51` |
| One eval drains **every** worker shard | `src/cms/service/EvaluationService.py:108-110` |

### 2.2 The evaluation service is single-contest by construction

| Fact | Evidence |
|---|---|
| Constructor takes one `contest_id` | `EvaluationService.py:270-273` |
| The queue is filtered by that one contest | `EvaluationService.py:427` `get_submissions_operations(session, self.contest_id)`; `:432` user tests |
| `invalidate_submission` defaults to the same one | `EvaluationService.py:985-987`, `:1032-1033` |
| `contest_id` bootstraps from env `CONTEST_ID` | `src/cms/db/util.py:200-232` |
| Otherwise it reads `contests.is_active` | `src/cms/db/util.py:168-172` |
| `is_active` is unique by a partial index (`contests_single_active_key … WHERE is_active`); activation clears then flags in one transaction, because the index is checked per row | `admin-panel/prisma/migrations/20261015153000_single_active_contest/migration.sql`; `admin-panel/src/lib/active-contest.ts:23-45`; `scripts/__contest_set_active.sh` |

### 2.3 The panel can only reach one evaluation service

`admin-panel/src/lib/evaluation-rpc.ts:3-4` hardcodes `cms-evaluation-service:25000`. There is no parameter, no list, no resolve step.

### 2.4 Exposure is four fixed roles, one address each

| Fact | Evidence |
|---|---|
| Roles are `DOMAIN_NAME` primary, `ADMIN_DOMAIN`, `OJ_DOMAIN`, `RANKING_DOMAIN` | `config/grader.nginx.conf.template:54,69,128,166,198` |
| The contest proxy renders exactly one `server_name` | `scripts/__nginx-proxy-render.sh:82-181` |
| It proxies to the single `cms_contest` upstream | same, `:106,110,151,155` |
| `NGINX_HOST` = `CONTEST_DOMAIN` | `docker-compose.yml:413` |
| `[contest] CONTEST_DOMAIN` is documented as *the* server_name, empty = `CMS_DOMAIN` | `config.toml.example:168` |

### 2.5 Tailscale runs two mechanisms with no shared source

| Fact | Evidence |
|---|---|
| One `cms-tailscale` container, `depends_on: contest-web-server`, `TS_SERVE_CONFIG=/config/serve.json` | `docker-compose.tailscale.yml:10-37` |
| That file fronts the **contest** only: `/` to `http://contest-web-server:8888`, `AllowFunnel` on | `config/tailscale/serve.json` |
| `TS_CERT_DOMAIN` appears only in that file and is set nowhere in this repo — tailscaled substitutes it | repo-wide grep; `docs/ADDRESS-MODEL.md:141-155` |
| Admin, classic admin and ranking instead go through **host-side** `tailscale serve` driven by `TS_HTTPS_PANEL/CLASSIC/RANKING` | `scripts/__tailscale_serve.sh:55-66`; `tools/cms-tui/src/core/expose.rs:135-157`; `docs/ADDRESS-MODEL.md:152-155` |
| The contest UI deliberately has no `ts-https` entry in **that** mechanism | `docs/ADDRESS-MODEL.md:154-155` |

Two exposure paths exist — a container Funnel for the contest, a host `tailscale serve` for the admin surfaces — and **neither derives from the database**. Multi-contest must render both from one model, or the second mechanism silently keeps fronting the wrong service.

An earlier reading of this section called `TS_HTTPS_*` dead config. That was wrong: the keys are live and load-bearing, and the contest's absence from that mechanism is deliberate.

### 2.6 The panel's existing worker model

`admin-panel/src/lib/worker-nodes.ts` is the single worker-node model; `worker-stats.ts:113-124` merges three config sources (env, `config.toml`, `.env`) and `:149-161` counts open evaluations per shard. Both are shard-keyed and contest-blind.

## 3. Confirmed decisions (round 1, 2026-10-13)

| # | Question | Answer | Consequence |
|---|---|---|---|
| 1 | Which layer changes | **B — the Python service becomes multi-tenant** | One `cmsEvaluationService` process drains many contests; `CONTEST_ID` stops being an identity |
| 2 | Source of truth | **A — Prisma DB authoritative** | A migration is unavoidable; `./cms config sync` becomes a renderer of DB rows |
| 3 | Exposure model | **Custom:** "all independent hostname / subdomain, and able to be `$hostname/a` `$hostname/b` … and any possible way to deploy" | Routing must be a data model, not four hardcoded roles. Section 4 Q10 pins the v1 subset |
| 4 | Tailscale topology | **B — one Tailscale container per contest** | N nodes, N authkeys, N device rows, N state volumes. Cost acknowledged in Q11 |
| 5 | Worker binding | **Custom:** "one eval for all and same worker set — or multiple with different wire — all config in DB with hot swapping/hot-update and lower usage of config in host" | Must support shared-fleet *and* partitioned wiring from one mechanism, DB-authored |
| 6 | Backward compat | **Custom: "compare table and example"** | Comparison delivered; selection still open → Q6b |
| 7 | Stale lanes WIP | **B — port as-is, then clean** | Ported verbatim to `docs/reference/lanes-wip/` (section 10) |
| 8 | Acceptance | **B — typecheck + vitest suites** | `bun run build`/`tsc` + the `vitest` suites, with new unit tests for the renderer and resolver |

Notable tension to resolve, not ignore: answer 1 says one multi-tenant process; answer 5 says "or multiple with different wire". The design in section 5 satisfies both by making the **evaluation row** the unit of choice, so the count of eval services is data, not architecture.

## 4. Confirmed decisions (round 2, 2026-10-13)

| # | Question | Answer | Consequence |
|---|---|---|---|
| Q6b | Which authority wins | **Custom: a generic service registry with wiring to other services, and each contest carrying its own active contest id** | The DB is the authority. The global `is_active` singleton gives way to per-service and per-contest binding, so several contests are active at once. Section 5 states the one thing this leaves unstated |
| Q9 | Shape of the wire record | **Same — generic `services` + `wiring`** | Wider than the contest-scoped tables proposed earlier. The renderer must now resolve arbitrary links into concrete nginx/eval/serve config, and an unregistered service silently never renders |
| Q10 | Exposure forms in v1 | **All five:** independent hostname, subdomain, path prefix, per-contest tailnet, one-host runtime-switch | All five are render targets and all five need tests. This is the largest single test surface in the change |
| Q11 | Tailnet authkeys | **N containers, ONE reusable authkey** | `TAILSCALE_AUTHKEY` becomes a reusable key. One leaked key admits any node, so its scope and rotation matter more than the container count |
| Q12 | Hot-apply semantics | **Custom:** "nothing restart and collect state and cache for 5 secs for less load, and for those need the redeploy do redeploy" | Two change classes. State reads are live DB with a 5 s cache and no restart; anything a mounted config encodes is a targeted redeploy. Section 5.4 |
| Q13 | Deliverable | **Full implementation** | Prisma + renderer + Python multi-tenant + panel + tests, in this worktree |
| Q14 / Q17 | Worktree target | **Custom: `cms-hub/*`, beside the other worktrees, outside any repo** | Applied. Section 4.1 |
| Q15 | DB bootstrap | **Extend `[db_<name>]` + `ACTIVE_DATABASE` into a per-service profile** | `config.toml` keeps the DB pointer; the DB holds everything else. Reuses the mechanism already at `config.toml.example:38-58` |
| Q16 | Remote worker DB | **Main DB, over the tailnet** | `Worker.py:33,87-89` reads `Contest` + `enumerate_files` and writes no session, so a worker owns no data |
| Q20 | Wiring permission | **Reuse `container:control`** | Wiring is an infra operation; no new permission key to seed |
| Q21 | Tailnet key storage | **`config.toml` only, never the DB** | A DB dump then leaks no tailnet access |
| Q23 | Scope tonight | **All five phases, quality over completeness** | Stop at the first phase that cannot be verified rather than half-build a surface |
| Q24 | Legacy scripts | **Read the DB, keeping core/DB env in `config.toml`** | Scripts become N-generic instead of gaining a parallel path |
| Q25 | Panel surface | **A Services & Wiring settings screen reusing core components** | Server-first, locale-aware, `container:control`-gated, no secrets. See 5.9 |

### 4.1 Naming convention — `cms-hub/*` is now the main way

Worktrees live at `CMS-Hub/cms-hub/<topic>` on branch `cms-hub/<topic>`: beside the other worktrees, and outside any git repository, since `CMS-Hub` is not a repo and `cms-docker` is.

Deliberately not done: the existing `.worktrees/agent-*` directories were **not** migrated. They are live worktrees belonging to other running sessions, and moving one mid-write can corrupt its state. Migrating them needs a separate explicit go-ahead and is safest between sessions.

## 5. Target architecture (confirmed, with one inference)

**Inference to confirm.** Q6b came back as a description of the model rather than a choice between "additive `is_active`" and "DB wiring as the only authority". This document takes it as the latter: the DB authors the bindings, and `CONTEST_ID` survives only as a rendered legacy value. If the intent was additive, only section 5.1 changes.

### 5.1 Authority and bootstrap

Two stores, strictly ranked:

| Store | Holds | Why |
|---|---|---|
| `config.toml` | the DB pointer and secrets only — which `[db_<name>]` profile is active | A process cannot read the DB without first knowing where it is. `scripts/__config_sync.sh:1303-1308` already reaches Postgres through `[core] POSTGRES_*` |
| the database | everything else: which contests are served, which services exist, how they wire, where each answers | One authority, so nothing can disagree |

`./cms config sync` stays output-only and becomes a renderer of DB rows. The global `contests.is_active` singleton is retired in favour of per-service and per-contest binding; `CONTEST_ID` is still rendered so every existing script and compose variable keeps working unchanged.

### 5.2 Schema — the generic registry

```prisma
model services {                 // every server the deployment runs
  id          Int     @id @default(autoincrement())
  name        String  @unique    // cms-contest-web-server-1
  role        String             // ContestWebServer | EvaluationService | Worker | ProxyService | ...
  shard       Int     @default(0)
  host        String
  port        Int
  db_profile  String  @default("default")  // -> config.toml [db_<name>]
  contest_id  Int?               // null = serves every contest; set = bound to one
  enabled     Boolean @default(true)
  outgoing    wirings @relation("from_service")
  incoming    wirings @relation("to_service")
}

model wirings {                  // the wire: one service linking to another
  id           Int @id @default(autoincrement())
  from_service Int
  to_service   Int
  relation     String            // drains | fronts | proxies

  from services @relation("from_service", fields: [from_service], references: [id])
  to   services @relation("to_service",   fields: [to_service],   references: [id])

  @@unique([from_service, to_service, relation])
}

model contest_exposure {         // where each contest answers
  id          Int     @id @default(autoincrement())
  contest_id  Int
  hostname    String
  path        String  @default("/")
  tls         Boolean @default(true)
  tailnet     String?
}
```

The trade to keep visible: `services` + `wirings` is powerful, but a service that is never registered silently never renders, and the renderer must resolve arbitrary links. Section 10 records the narrower alternative.

### 5.3 DB profiles become per-service

`[db_<name>]` blocks already exist (`config.toml.example:38-58`); `ACTIVE_DATABASE` picks one **globally**. Q15 extends that selection to `services.db_profile`, so one contest or one remote worker can point at a different profile without disturbing the rest. The global key stays as the default for services that name none, which keeps a single-DB deployment byte-identical.

### 5.4 Hot-apply — two change classes

| Change | Mechanism | Restart |
|---|---|---|
| State a read path needs (worker liveness, wiring lists, contest state) | live DB read behind a 5 s cache | none |
| Anything a mounted config encodes (nginx blocks, `serve.json`, `cms.toml` service lists) | render, then `docker compose up -d` **only** the affected services | targeted |

The 5 s cache is what makes the no-restart path cheap: it bounds query rate independently of panel traffic. The redeploy is not optional for the second class — a running container cannot re-read a bind-mounted file, so "hot" there means "narrow", not "instant".

### 5.5 Evaluation service multi-tenancy

`EvaluationService.__init__(shard, contest_id=None)` already tolerates a null contest. The change is to stop reading `None` as "bootstrap from `CONTEST_ID`" and start reading it as "every contest this service is wired to", then scope the operation scan per contest instead of globally. `workers_status` gains a contest dimension so the panel can attribute a busy worker to a contest.

### 5.6 Exposure rendering

All five forms are v1 targets (Q10), so the renderer is general rather than case-by-case: every `contest_exposure` row becomes a `server` block keyed on `hostname` + `path`, proxying to that contest's `ContestWebServer` service row. Path prefixes additionally need base-path-safe CMS URLs, cookie `Path` scoping, and no collision with the panel's `/en` | `/th` locale prefix.

### 5.7 Tailscale

Both existing mechanisms render from the same rows (Q11: N containers, one reusable authkey):

- container Funnel — one `cms-tailscale-<contest>` each, its own `serve.json`, `TAILSCALE_AUTHKEY` reusable across all of them;
- host `tailscale serve` — the mapping `scripts/__tailscale_serve.sh:62-66` currently hardcodes to three admin surfaces.

Leaving the two hand-written independently is what makes them drift the moment a contest is added; section 10 records it.

### 5.9 Panel surface (Q25)

One settings screen renders the registry, the wirings and the exposures, and mutates them through Server Actions:

- **Reuse only.** `components/core/*` primitives plus the existing glass tokens; no new primitives, no inline styles, no template-literal classNames.
- **Server-first.** A Server Component reads through Prisma; Server Actions mutate with `ensurePermission('container:control')` and `revalidatePath`.
- **Locale-aware.** `/${locale}/...` from `params.locale`; never a literal `/en`.
- **Standard shape.** Tables for the registry and the exposures, a modal for add/edit, an explicit from/to/relation editor for wirings, toasts for outcomes.
- **No secrets.** Endpoints are internal host:port; the tailnet authkey never enters the screen or the database.

### 5.8 Panel reach

`evaluation-rpc.ts:3-4` stops hardcoding `cms-evaluation-service:25000`; the RPC target resolves from `services` + `wirings`, so a contest bound to its own evaluation service is addressed at its own endpoint.

## 6. Worked example

Target: contest 1 at `a.example.com/`, contest 2 at `example.com/beta`, contest 3 at `b.example.com/`, all live together.

```
services
  cms-contest-web-server-1 | ContestWebServer  | shard 0 | contest 1 | db default
  cms-contest-web-server-2 | ContestWebServer  | shard 0 | contest 2 | db default
  cms-contest-web-server-3 | ContestWebServer  | shard 0 | contest 3 | db default
  cms-evaluation-service   | EvaluationService | shard 0 | null      | db default   # serves all three
  cms-worker-0 … cms-worker-3 | Worker         | shard n | null      | db default
wirings
  cms-evaluation-service -> cms-worker-0 … 3            | drains
  grader-nginx-proxy     -> cms-contest-web-server-1 … 3 | fronts
contest_exposure
  1 | a.example.com | /     | tls | cms-contest-1
  2 | example.com   | /beta | tls | cms-contest-2
  3 | b.example.com | /     | tls | cms-contest-3
```

```nginx
server { server_name a.example.com; location /     { proxy_pass http://cms-contest-web-server-1:8888; } }
server { server_name example.com;   location /beta { proxy_pass http://cms-contest-web-server-2:8888; } }
server { server_name b.example.com; location /     { proxy_pass http://cms-contest-web-server-3:8888; } }
```

Adding contest 4 is one `services` row, one `wirings` row, one `contest_exposure` row and a sync — no host edit. Binding contest 2 to its own evaluation service is one `contest_id` on the eval row plus one wiring, and nothing else moves.

## 7. Phasing

1. **Schema + resolver** — migration for `services` / `wirings` / `contest_exposure`, resolve helpers, unit tests. The resolver must fail loudly on a service a wiring names and the registry does not carry.
2. **DB profiles** — `services.db_profile` resolves against the existing `[db_<name>]` blocks; the global `ACTIVE_DATABASE` stays the default.
3. **Renderer** — sync emits N server blocks plus both tailnet artifacts from the same rows; verified with `docker compose config`.
4. **Evaluation multi-tenancy** — drop the single-contest filter; `workers_status` per contest.
5. **Panel surface** — wiring editor on the existing lanes/deployments screens, state reads behind the 5 s cache.
6. **Legacy retirement** — delete the dual paths once N=1 and N>1 both pass.

## 8. Acceptance

Green `bun run build` (or `tsc --noEmit`) in `admin-panel/`, the `vitest` suites, plus new unit tests for the resolver and the renderer. A two-contest `docker compose config` render is evidence, not the gate (answer 8 = B).

## 9. Dissent record — alternatives rejected, with evidence

1. **A contest-scoped pair of tables** — the earlier `contest_wiring` + `contest_exposure` proposal — instead of the generic registry: narrower, and harder to misuse, because only contests could be wired. Rejected on your answer, but note the cost it avoided: with a generic registry an unregistered service is *silently* invisible, so the resolver must fail loudly rather than skip it.
2. **Reusing `cms.toml` service arrays** with a contest tag: contradicts answer 5 ("lower usage of config in host") and cannot express host/path at all — `config/cms.sample.toml:38-53` has no routing fields. Rejected.
3. **Live per-request DB reads** (Q12 B) *without* the redeploy half: a container's mounted nginx/`serve.json` cannot change without a recreate, so on its own this looks hot and is not. Half-adopted — Q12 keeps live reads behind a 5 s cache for read paths and reserves the redeploy for mounted config.
4. **One tailnet node with N handlers** (Q11 C) instead of N nodes: cheaper in authkeys, devices and state, and the admin surfaces already work exactly this way through host-side `tailscale serve` (`scripts/__tailscale_serve.sh:62-66`), so the precedent is in-tree. Answer 4 chose isolation, so this stays the documented fallback — flagged because answer 5's "lower usage of config in host" points the other way.
5. **Additive `is_active`** (Q6b A) instead of replace: safe, but with two authorities an operator can wire contest 3 and still carry `CONTEST_ID=1`, and nothing states the precedence. Only acceptable with an explicit rule.
6. **Two independent tailnet renderers** — keeping `config/tailscale/serve.json` hand-written while `__tailscale_serve.sh` computes its own map — instead of one source: that is what section 2.5 found, and with N contests it guarantees the two drift, because adding contest 4 touches one and not the other. Rejected.
7. **Keeping `ACTIVE_DATABASE` global** and giving per-service DB selection its own parallel mechanism: rejected because the repo already has `[db_<name>]` profiles (`config.toml.example:38-58`), so a second mechanism would be two sources for one fact. Q15 extends the existing one instead.
8. **Committing the lanes WIP in place** (answer 7) instead of a reference copy: it imports `prisma.evaluation_workers`, which does not exist in this schema (verified: zero matches), so it would red the build before Q9 is answered. Ported verbatim instead — see section 10.

## 10. Reference material ported

`docs/reference/lanes-wip/` holds the unlanded `feat/evaluation-lanes` work verbatim: `worker-endpoints.ts`, `evaluationWorkers.ts`, `evaluationLaneBoard.ts`, two components, the old `evaluation-rpc.ts`, its migration, and a 1 920-line patch of the 13 tracked files it touched. `workers_status` was verified to exist in the current tree (`EvaluationService.py:439`, authorized at `src/cms/server/admin/rpc_authorization.py:31`), so the WIP's RPC call is sound. Read it as design; re-derive it against the schema in section 5.2.

## 11. Status — what landed and what did not (2026-10-13)

### 11.1 Landed and verified

| Step | Where | Evidence |
|---|---|---|
| `services`, `wirings`, `contest_exposures` models plus the `contests` back-relations | `admin-panel/prisma/schema.prisma` | `prisma generate` exit 0 — the schema validates |
| Guarded, idempotent table DDL | `admin-panel/prisma/migrations/20261013170000_service_wiring_registry/` | column-by-column agreement with `prisma migrate diff` output |
| Generated RLS for the three tables | `admin-panel/prisma/migrations/20261013173321_service_wiring/` | `scripts/__check_rls_coverage.sh` → 53 tables matched |
| Resolver: path normalisation, wiring join, per-contest selection, upstream precedence | `admin-panel/src/lib/service-wiring.ts` | 33 vitest cases |
| Renderer: nginx blocks, tailnet serve config, injection rejection | `admin-panel/src/lib/service-wiring-render.ts` | 33 vitest cases |
| Per-service DB profile validation, fatal on an unknown `[db_<name>]` | `scripts/__config_sync.sh` | `bash -n` clean; no new shellcheck warnings |
| Backup catalog placement | `admin-panel/src/lib/backup-table-catalog.ts` | 54 catalog tests pass |
| Renderer CLI: payload on stdin, validation before render, non-zero exit on refusal | `admin-panel/src/lib/service-wiring-cli.ts` | 9 vitest cases |
| `config sync` renders the generated route artifacts from the registry | `scripts/__config_sync.sh` (`render_wiring_artifacts`) | `tests/test_service_wiring_render.sh` — 11 assertions |
| A service carries two ports: `http_port` (what a front door proxies to) and `rpc_port` (what its peers dial) | `admin-panel/prisma/schema.prisma` | DDL column-for-column with `prisma migrate diff` |
| Store: validation before every write, upsert-by-key, records that carry their id | `admin-panel/src/lib/service-wiring-store.ts` | 12 vitest cases |
| Server actions, each demanding `container:control` in its own body | `admin-panel/src/app/actions/serviceWiring.ts` | the repository's own `permission-coverage` suite passes |
| The screen: route `infrastructure.services`, page, view, dialog, tables | `admin-panel/src/app/[locale]/(authenticated)/infrastructure/services/page.tsx`, `components/infrastructure/` | `tsc` clean, full suite green, `en`/`th` keys at parity, the navigation and shortcut guards updated |
| A client-safe contract module, so no screen imports Prisma | `admin-panel/src/lib/service-wiring-contract.ts` | the store keeps Prisma; components import only the contract |
| The certificate a TLS block points at is a parameter, with the shared ssl include | `admin-panel/src/lib/service-wiring-render.ts` (`CertificateSpec`), CLI `--cert/--key/--ssl-include` | 6 vitest cases |
| The domain proxy consumes the generated routes | `config/grader.nginx.conf.template` (glob include), `docker-compose.domain.yml` (mount) | `docker compose -f docker-compose.domain.yml config` valid; 15 shell assertions |
| A TLS exposure with no certificate lineage fails the sync instead of rendering an unpointable cert | `scripts/__config_sync.sh` | `tests/test_service_wiring_render.sh` Test 5 |
| Contest hostnames join the domain certificate's SAN list, deduplicated against the configured domains | `scripts/__config_sync.sh` (producer), `scripts/__domain.sh` (`wired_tls_hostnames`, `build_cert_domains`) | `tests/test_cert_domains.sh` — 5 assertions |
| One tailnet serve config per node, with the node name held to a single DNS label | `admin-panel/src/lib/service-wiring-render.ts` (`renderServeConfigs`, `assertSafeTailnetNode`) | 10 vitest cases including a traversal refusal |
| One generated tailscale container per node, each mounting its own serve config and referencing the authkey rather than copying it | `scripts/__config_sync.sh` (`render_tailscale_compose`) | `tests/test_service_wiring_render.sh` — the file is validated with `docker compose config` |
| The write boundary rejects an unsafe tailnet name too, so a traversal never reaches the table | `admin-panel/src/lib/service-wiring-store.ts` | 5 vitest cases |
| The registry chooses whether the evaluation service serves one contest or all, and compose consumes it | `scripts/__config_sync.sh` (`derive_evaluation_contest_arg`), `docker-compose.yml` | `tests/test_service_wiring_render.sh`; verified by rendering the real compose file with `-c ALL`, `-c 7`, and unset |
| The RPC target resolves from the registry, per contest, with the compose constant as the empty-registry fallback | `admin-panel/src/lib/evaluation-endpoint.ts`, `evaluation-rpc.ts`, `actions/submissions.ts` | 10 vitest cases, including an end-to-end call that dials the bound service and one that refuses when nothing serves the contest |
| The registry outranks `contests.is_active` for which contest the deployment serves | `scripts/__config_sync.sh` (`registry_primary_contest_id`, `set_contest_id`) | `tests/test_service_wiring_render.sh` — one test proves the registry wins, another proves the singleton still answers an empty registry |
| The registry's choice is mirrored back onto `contests.is_active`, and skipped when the registry is silent | `scripts/__config_sync.sh` (`sync_active_contest_flag`) | `tests/test_service_wiring_render.sh` — the test reads the SQL the script issued, and asserts an empty registry issues no `UPDATE contests` |

Gates: `tsc --noEmit` clean · `vitest run` **250 files / 3253 tests passed** · `make test` **all suites passed** · RLS coverage 53 tables · `bash -n` and shellcheck clean on `__config_sync.sh`.

### 11.2 Not landed

| Phase | Missing | Why it stopped |
|---|---|---|
| 3 — renderer wiring | **Done.** The domain front consumes the generated routes and certifies them, and the tailnet side is per-contest: one serve config per node, one generated tailscale container per node. Still hand-written and left alone deliberately: the *host-side* `tailscale serve` map (`scripts/__tailscale_serve.sh:62-66`) for the three admin surfaces — that is a different mechanism (host CLI, not a container funnel) and this change did not touch it | — |
| 4 — evaluation multi-tenancy (deployable; two items left) | **A finding first:** the service already supports serving every contest — `cmsEvaluationService -c ALL` resolves through `contest_id_from_args` (`cms/util.py:248`) to `contest_id=None`, and `esoperations.get_submissions_operations` already turns `None` into `literal(True)` (`esoperations.py:317-320`). The capability existed; **nothing could launch it.** Now the registry decides: `derive_evaluation_contest_arg` publishes `EVALUATION_CONTEST_ARG="-c ALL"` for an evaluation row with `contest_id IS NULL`, `"-c <id>"` for a bound one, and leaves it unset when no registry table exists, so today's behaviour is preserved. (b) is now closed as well: the RPC target resolves from the registry (`evaluation-endpoint.ts`), preferring a row bound to the submission's contest over the shared one, and keeping the compose constant only for an empty registry. Still open: `workers_status` has no contest dimension, so the panel cannot attribute a busy worker to a contest | The last item is panel reporting, not serving |
| 5 — panel surface | Done for its scope: create, edit in place and remove for all three collections, destructive removals confirmed through the panel's own confirmation store, the screen gated on `container:control`. Not attempted: bulk edit, and an import that seeds the registry from an existing single-contest deployment | — |
| 6 — the authority switch (read and write done) | `contests.is_active` is no longer the authority in either direction. **Read:** `derive_contest_id_from_db` asks the registry first (`registry_primary_contest_id`) and falls back to the singleton only when the registry names no contest. **Write:** `sync_active_contest_flag` mirrors the registry's choice back onto `is_active` with the same whole-table statement `./cms contest set-active` issues, so the panel agrees with the stack; it no-ops when the registry is silent, so an untouched deployment keeps its flag. `CONTEST_ID` is still rendered. **Not done:** scripts still read `CONTEST_ID` from the rendered file rather than querying the DB (Q24) — they consume the rendered value, which is now correct, but they do not read the registry themselves | The remaining item is a wider refactor of every consumer script for no behavioural gain |

Still true and important: `contests.is_active` remains the authority in `scripts/__config_sync.sh`. The schema and the profile validation for per-service binding landed; the authority switch (5.1) did not. N=1 behaves exactly as before.

### 11.3 Running the gate

The workspace write-quota cannot hold the ~1 GB dependency tree, so the gate runs from a mirror on `/tmp`:

```sh
# once
cp -a admin-panel /tmp/cms-hub-build/admin-panel
cd /tmp/cms-hub-build/admin-panel && bun install --frozen-lockfile && ./node_modules/.bin/prisma generate
cd - && tar --exclude=./admin-panel --exclude=./.git -cf - . | tar -C /tmp/cms-hub-build -xf -
# each run
/tmp/gate.sh tsc    # tsc --noEmit
/tmp/gate.sh test   # vitest run
```

## 12. Merge readiness (checked 2026-10-14)

Verified in a scratch clone, without touching this branch or its history:

```sh
git clone --shared --no-hardlinks <repo> /tmp/cms-merge-check
git -C /tmp/cms-merge-check fetch <repo> cms-hub/evaluation-multi-contest:merge-check
git -C /tmp/cms-merge-check checkout major/admin-panel
git -C /tmp/cms-merge-check merge --no-edit merge-check
```

**The merge is clean**: `git merge-tree --write-tree` exits 0, the merge applies with no conflicts,
and on the merged tree `make test` reports **all suites passed** with `tsc --noEmit` clean.

### 12.1 One line must change after merging

`admin-panel/tests/navigation-contracts.test.ts` pins the route count, and **both sides
independently bumped the same constant from 57 to 58** — this branch for `infrastructure.services`,
major for `notifications`. Identical lines merge without a conflict, so the stale number survives
and the merged suite fails with `expected 59 to have a length of 58`:

```sh
sed -i 's/expect(ROUTE_REGISTRY).toHaveLength(58)/expect(ROUTE_REGISTRY).toHaveLength(59)/' \
  admin-panel/tests/navigation-contracts.test.ts
```

| Ref | registry entries | `infrastructure.services` | `notifications` | constant |
|---|---|---|---|---|
| `a093b003` (base) | 29 | — | — | 57 |
| `major/admin-panel` | 30 | — | yes | 58 |
| this branch | 30 | yes | — | 58 |
| merged | **31** | yes | yes | 58 → must become **59** |

This is the only divergence the merged suite reports: **3382 of 3383** tests pass and the one
failure is that counter. It is a merge artefact rather than a defect in either branch, so it is
recorded here instead of fixed on this branch — changing it here would break this branch's own
suite, which legitimately has 58.
