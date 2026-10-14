# Handoff — DB-driven service registry: runnable task set (2026-10-14)

Main's role from here: **server update + planning only** (the user runs the dev steps in another
provider). This file is the complete, self-contained task list.

## Context
- **Epic:** a full DB-driven service registry + its admin-panel UI — every service (IP/port),
  exposure (a loopback port → a **hostname** or a **path** like `/classic` or `/beta`), and eval
  wiring (one contest or many) lives in the **database**; nothing hardcoded in compose/nginx/panel.
- **Repo:** `github.com/champyod/cms-docker`. **Base:** `major/admin-panel` @ `117394c8`.
- **Work branch:** `cms-hub/db-registry-ui` (worktree; at `3915fe9b` after step 1).
- **Read first:** `docs/superpowers/specs/2026-10-14-service-registry-db-driven-ui-design.md` — the
  gap list (G1–G22), defects C1–C5, the contract map, the UI plan, the hot-apply map.
- **Decisions (settled):** D1 = **B** (a path exposure injects location fragments into the **owning
  vhost**); D2 = the sync **never writes** `contests.is_active`; the legacy `CONTEST_ID` reads the
  registry's `ContestWebServer` contest when the DB has one, else the documented fallback; D3 =
  **Epic 5 included** (compose generated from the registry).
- **Conventions:** one step = one commit (Conventional Commits; no trailers). Clean code: WHY-only
  terse comments, ≤40-line functions, ≤250-line files, no `as any`/`@ts-ignore`/`eslint-disable`,
  no silent catch, no TODO/placeholder comments, no debug logs. Verify with the panel's gates
  (`bun run lint`, `bunx tsc --noEmit`, `bun run test`) **and** the shell suite
  `bash tests/test_service_wiring_render.sh`.
- **Environment:** the worktree lives on `/home` (the `/mnt/Datas` NTFS mount fails writes). Symlink
  `admin-panel/node_modules` to a working install when you need the panel gates.

## Status
- **Done:** step 1 (`3915fe9b` — `port` → `http_port, rpc_port` + the schema-agreement guard).
- **Remaining:** steps 2–19 below.

## Parallelism
Steps 2–4 are the shared foundation (sequential). At the seam, **Epic 2 (8–11)** and **Epic 3
(12–15)** touch disjoint files and may run in parallel (separate branches, merge at the seam). Epic 4
and Epic 5 follow.

---

## Epic 1 — editing a row updates it; a sync never moves the active contest

### Step 2 — `fix(config): stop the sync writing the active contest`
**File:** `scripts/__config_sync.sh` (~`:1584-1680`, call `:1779`); `tests/test_service_wiring_render.sh`.
Delete `sync_active_contest_flag` and its call. Keep the **read**: `CONTEST_ID` still follows the
registry's `ContestWebServer` contest when present, else `contests.is_active`. The sync must issue
**no `UPDATE contests`**; when the two diverge emit a `log_warn` naming both (read-only).
**Tests:** replace `mirrors the registry's choice onto contests.is_active` with (a) an assertion the
sync SQL contains no `UPDATE contests` and (b) a divergence-warning assertion; keep
`takes CONTEST_ID from the registry, not from is_active` passing.
**Verify:** `bash tests/test_service_wiring_render.sh`.

### Step 3 — `feat(panel): carry the row id through the registry write contract`
**File:** `admin-panel/src/lib/service-wiring-contract.ts` (~`:22-47`).
Add `id?: number` to `ServiceInput`, `WiringInput`, `ExposureInput`. No store change yet.
**Verify:** `bunx tsc --noEmit`; the contract tests.

### Step 4 — `fix(panel): update a registry row by id instead of forking it`
**Files:** `admin-panel/src/lib/service-wiring-store.ts` (~`:73-135`); store tests.
Branch on `id`: `id === undefined ? create : update({ where: { id } })` for all three inputs. A create
that collides (duplicate name; duplicate wiring triple; duplicate `(contest, hostname, path)`) must be
a **typed domain error**, never an overwrite. Call `normalisePath` **before** `assertSafePath` in
`validateExposure` (so `/beta/` and `/beta` cannot both exist). Fixes C2, C3, C4, C4-companion.
**Tests:** rename updates in place; a colliding add is refused; `/beta/` and `/beta` are one row.
**Verify:** `bun run test`.

### Step 5 — `fix(panel): the registry dialog carries the id and refuses a blank number`
**Files:** `admin-panel/src/components/infrastructure/registry-spec.ts` (~`:46-107`),
`ServiceRegistryView.tsx` (~`:49-131`).
Create vs edit; `requiredInt` must **throw** on blank (not return `0`); no `as` cast.
**Verify:** component tests; `bunx tsc --noEmit`.

### Step 6 — `fix(panel): revalidate the registry screen that changed`
**File:** `admin-panel/src/app/actions/serviceWiring.ts` (`:36,55`).
`REGISTRY_PATH` must be `/infrastructure/services` (not `/[locale]/settings`).

### Step 7 — `feat(panel): report registry problems before a sync`
**Files:** `admin-panel/src/lib/service-wiring.ts` (+ the view).
Add a non-throwing `collectWiringProblems()` — a contest with no `ContestWebServer`, a wiring naming a
missing id, two exposures on one location — surfaced per row in the screen.
**Verify:** unit tests on the collector.

---

## Epic 2 — a contest can answer at a path of an existing vhost (D1 = B)

### Step 8 — `feat(panel): group exposures by hostname into one server block`
**File:** `admin-panel/src/lib/service-wiring-render.ts` (`:91-122`).
Group by hostname with a `Map` (O(n)); emit one `server` per hostname with N locations (owner first).
**Verify:** renderer tests incl. `example.com/` + `/beta` in one block.

### Step 9 — `feat(domain): include generated locations in each vhost`
**Files:** `config/grader.nginx.conf.template`, `scripts/__domain_routes.sh` (`:275-310`),
`docker-compose.domain.yml` (`:54-63`).
Add an `include /etc/nginx/generated/locations-<name>.conf;` inside each vhost; reuse the
`ROUTE_OWNER` precedence (`__domain_routes.sh:188-193`); the root exposure takes over `location /`.
**Verify:** `docker compose config`; `nginx -t`.

### Step 10 — `feat(panel): allow a path-only exposure`
**Files:** `admin-panel/prisma/schema.prisma` (`975-987`) + a migration; the store;
`service-wiring.ts:129-144`.
`hostname` nullable; `@@unique([hostname, path])` → `@@unique([contest_id, hostname, path])`.
**Verify:** `prisma migrate diff` agreement; resolver tests.

### Step 11 — `fix(panel): give generated contest routes the front's security headers`
**File:** `admin-panel/src/lib/service-wiring-render.ts` (`:91-111`).
Add `Host`, `X-Real-IP`, `X-Forwarded-For/Proto` and `LOCATION_SECURITY_HEADERS`, matching the curated
vhosts (`grader.nginx.conf.template:84-87,115`). Closes G19.
**Verify:** rendered-output assertions.

---

## Epic 3 — the panel is the registry's editor

### Step 12 — `refactor(panel): source every registry string from the dictionary`
**Files:** `registry-spec.ts` (`:19-56`), `ServiceRegistryView.tsx`, `RegistryEntryDialog.tsx`,
`RegistryTable.tsx`, `dictionaries/{en,th}.json`.
Carry keys, not labels; add the `infrastructure.services.*` tree (columns/fields/actions/values/empty/
confirm/toast/errors/preview) to **both** dictionaries (parity is a test).
**Verify:** `bun run test` (the dictionary-parity suite).

### Step 13 — `refactor(panel): rebuild the registry screen on the templated primitives`
**Files:** `admin-panel/src/components/infrastructure/*`.
`ResponsiveTable` + `RowActions` + `EmptyState` + `Card`; tabs via `DetailSurface`; delete
`RegistryTable.tsx` (no index keys, no raw `<table>`). Closes G15.
**Verify:** component tests.

### Step 14 — `feat(panel): gate the registry actions and add page states`
**Files:** `ServiceRegistryView.tsx`, `RowActions` usage, `infrastructure/{loading,error}.tsx`.
`RowActions permission={['container:control']}`; render Add only when held; per-tab empty copy. Server
side unchanged — each action keeps its own `ensurePermission('container:control')`. Closes G16.

### Step 15 — `feat(panel): preview the artifacts a registry change would render`
**Files:** the view + a read action.
Import `renderFromPayload` in-process (no shell-out); show the next artifacts beside each change's
hot-apply class.
**Verify:** a unit test on the same function the sync uses.

---

## Epic 4 — apply a registry change from the panel

### Step 16 — `feat(panel): re-sync the registry from the panel`
**Files:** `admin-panel/src/app/actions/serviceWiring.ts`, reuse `deploy-config.ts:10-14`.
A **fixed** command string (`bash scripts/__config_sync.sh`) — never operator text; write an audit row.

### Step 17 — `feat(panel): apply a registry change by class`
**Files:** the action + `restart-service-scope.ts`.
Reload the front / recreate the tailnet node / targeted `up -d`, per the design's hot-apply map.
**Verify:** the mapping test.

---

## Epic 5 — compose from the registry

### Step 18 — `feat(config): generate the contest/eval/proxy compose from the registry`
**File:** `scripts/__config_sync.sh` (extend the `render_tailscale_compose` pattern, `:1397-1435`).
N `services` rows → N containers; no fixed container name, port or `CONTEST_ID`.
**Verify:** `docker compose config`; the render suite.

### Step 19 — `refactor(panel): one source for the restart scope and the role palette`
**Fix:** `admin-panel/src/lib/restart-service-scope.ts:15-29` reads the same source as the palette
rather than a second hand-written map.

---

## Step 20 — `feat(services): resolve bindings from the registry through a shared short-TTL cache`
**Files:** the Python launchers (`src/scripts/cmsContestWebServer`, `cmsEvaluationService`, `cmsProxyService`),
the resolver (`src/cms/db/util.py`), and — if a shared backend is chosen — one small config/resolver
service + a migration-free read path.
The services MUST resolve their bindings (served contest, eval endpoint) from the **DB** through a shared
**5 s TTL cache**, not from boot-time args/`.env` — so a registry change hot-applies to them within the
TTL. `.env`/`config.toml` remain only the **fallback** when the registry has no row (the
`ask_for_active_contest` pattern). Services hold the DB **read-only**; only the panel writes it.
Prefer one shared cache (a tiny backend every consumer reads) over per-service caches, so the TTL and the
view cannot drift. Secrets never enter the DB.
**Verify:** a test that a registry row change is observed within the TTL without a restart.

## Epic 6 — one lockout page (merge /ranking/lockouts into /security/blocks)

**Placement: apply this epic on `major/admin-panel` DIRECTLY** — no new branch, no worktree, no
checkout, and do not remove or rewrite any other contributor's work.

### Step 21 — `refactor(panel): one lockout page for every surface`
**Files:** delete the `ranking.lockouts` route id from `admin-panel/src/lib/navigation/{types,registry,registry-platform}.ts`,
`components/navigation/shell-nav.ts`, both dictionaries, and the route fixtures; delete
`admin-panel/src/app/actions/rankingLockouts.ts` and its page.
**Why one page already nearly works:** `/security/blocks` reads the whole `LOCKOUT_NAMESPACES` list
(`lib/login-lockouts.ts:9-17`), so it already lists the `cms:login:` (contest+admin) **and**
`cms:ranking:login:` (ranking) counters, each tagged with its surface.
**The wrinkle to fix:** the page's current unlock (`releaseLoginLockout`, `lib/security/lockouts.ts:43`)
clears the **contest** bucket shapes via `clearBucket`; the ranking keys need the **key-based** clear
(`clearLoginLockout(url, key)` → `clearLockouts` → `DEL`). Give each live-counter row a clear that routes
to the right namespace (`lockoutNamespaceFor(key)`), so a ranking-surface counter is unlockable from the
same page. Keep `lockout:read` / `lockout:unlock` as the gates.
**Verify:** the panel gates; a test that both namespaces' counters clear from the security page.

### Step 22 — `feat(panel): stream the lockout list live`
**Files:** new `admin-panel/src/app/api/security/lockouts/stream/route.ts`; `components/security/BlocksPanel.tsx`;
`lib/constants/live-stream.ts`.
Build the route on the **shared** stream helper (`createLiveStreamRoute` + the polled source), gated
`lockout:read`, polling **both** `LOCKOUT_NAMESPACES` (`cms:login:` and `cms:ranking:login:`) on a 5 s
cursor (total count + the key set), so a new lockout or an unlock pushes a frame. `BlocksPanel` consumes
it through the shared hook + `LiveRefresh` — no second stream, no bespoke polling. On `major/admin-panel`
directly.
**Verify:** the panel gates; a test that the route returns `text/event-stream` and closes on abort.

## Not in scope (leave untouched)
`contests.is_active`'s panel path (`active-contest.ts`, `services/contests.ts:204-219`); the
`container:control` key set; the tailnet authkey; `prisma-selects.ts`.

## Before step 18 on prod
Verify with `\d services` that no stray `port` column exists (the C5 assumption), then deploy via
`./cms` and re-run the sync.
