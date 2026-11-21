# DB-Driven Service Registry + Admin Panel UI — Design

**Date:** 2026-10-14 · **Branch:** `cms-hub/db-registry-ui` (base `major/admin-panel` `117394c8`)
**Status:** design approved; decisions settled (below). Layers per `2026-08-23-admin-panel-refactor-design.md`.

## Decisions (settled 2026-10-14)
- **D1 = B** — a path exposure joins the **owning vhost** by injecting location fragments (so
  `DOMAIN_NAME/beta` works, one vhost per name, and the front's security headers apply to contest
  routes). The nginx template + `__domain_routes.sh`'s ownership rule become part of the epic.
- **D2** — the sync stops writing `contests.is_active` (no unaudited domain write). The legacy
  `CONTEST_ID` follows the **contest-shard contest from the registry when the DB has it**; otherwise the
  documented fallback. The sync becomes read-only; divergence is a warning, never a write.
- **D3 = include Epic 5** — compose is generated from the registry rows too.

## Defects to fix (found by the design pass)
- **C5/G1 (P0 break):** `scripts/__config_sync.sh:1443` selects `port`; the columns are `http_port`,
  `rpc_port`. Any deployment with an exposure row fails `./cms config sync` (the test is blind — its stub
  answers from a fixture). Prod survives only because its registry is empty.
- **C1:** the sync writes `contests.is_active` (`__config_sync.sh:1611-1624`), unaudited, reverting the
  panel's activation.
- **C2:** service "edit" forks the row — `saveService` upserts on `name`, no id (`service-wiring-store.ts:73-82`).
- **C3:** wiring "edit" forks — upsert on `(from,to,relation)` (`:94-114`).
- **C4:** exposure upsert keyed `(hostname,path)` **steals another contest's row** on collision (`:125-135`);
  `path` is not normalised at write while it is at render (`/beta` vs `/beta/`).
- **C9/G9:** the three write inputs carry no `id` — the root cause of C2/C3/C4.
- **G14/G15/G16:** the screen is hardcoded English, bypasses `ResponsiveTable`/`RowActions`/`EmptyState`/`Card`,
  and its buttons are not permission-gated.
- **G18:** no hot-apply path from the panel; **G19:** generated routes lack the front's security headers;
  **G20:** two Prisma reads per render.

## Epics → steps (one commit each)
1. **Editing a row updates it; a sync never moves the active contest.** 1 select the real columns (C5) ·
   2 stop writing `is_active`; read-only + divergence warning (C1/D2) · 3 `id?` on the three write inputs ·
   4 update-by-id + typed collision errors + normalise `path` at write (C2/C3/C4) · 5 the dialog carries the
   id and a blank number is an error · 6 revalidate the screen that changed · 7 non-throwing problem collector
   surfaced per row.
2. **A contest can answer at a path of an existing vhost.** 8 group exposures by hostname (one block, N
   locations) · 9 include the generated locations in each vhost + the ownership rule · 10 path-only exposure
   (nullable hostname, unique per contest) + migration · 11 generated contest routes inherit the front's
   security headers.
3. **The panel is the registry's editor.** 12 every string from the dictionary (en+th) · 13 rebuild on the
   templated primitives · 14 per-action permission gates + page states · 15 Preview tab (render in-process).
4. **Apply a registry change from the panel.** 16 a scoped re-sync action · 17 apply by change class.
5. **Compose from the registry.** 18 generate the contest/eval/proxy services per row · 19 one source for
   the restart scope and the role palette.

## UI plan
One route (`infrastructure.services`) with `DetailSurface` tabs: **Services · Wirings · Exposures · Preview**.
Each table is `Card` + `ResponsiveTable` + `RowActions` (`permission: 'container:control'`) + `EmptyState`;
a problems banner lists `collectWiringProblems()` output. All copy from `dictionaries/{en,th}.json` under
`infrastructure.services.*` (parity is a test).

## Hot-apply per change class
Panel reads: live (5 s memo) · Python services: recreate the service · exposures: re-sync + `nginx -s reload`
in the front · new tailnet name: recreate that node · TLS/new hostname: `./cms domain` + front reload ·
`db_profile`: that service restarts · compose topology: render + targeted `up -d` · `contests.is_active`:
`./cms contest set-active` only. The rule to state in the UI: anything **mounted** is never instant.

## Config model (settled 2026-10-14)
Three layers, each may read only the layer below it — no cycles.

| Layer | Holds | Rule |
|---|---|---|
| **config.toml** (hand; never derived) | the DB connection (`[core]` host/port/user/password/db + backup password), the `[db_*]` profiles + `ACTIVE_DATABASE`, **all secrets** (`AUTH_SECRET`, `RPC_SECRET`, tailnet authkey, Postgres passwords), the bootstrap identity for the first bring-up | the irreducible root; a service may read it only as a **fallback** |
| **The DB** (source of truth) | `services`, `contest_exposures`, `wirings`, `contests.is_active`, RBAC, panel settings | everything that can be data |
| **Derived artifacts** (never a source) | `.env`, nginx routes, tailnet `serve.json`, generated compose | rendered from the DB by the sync |

**Secrets stay in config.toml** — never a DB row, never a panel field.

**Services ask the DB, not the launcher.** The Python services MUST resolve their bindings from the DB
through the same short-TTL cache the panel uses (5 s), not from boot-time args/`.env` — so a registry
change hot-applies to them within the TTL. `.env`/`config.toml` remain only the **fallback** when the
registry has no row (the `ask_for_active_contest` pattern). Services hold the DB **read-only**; only the
panel writes it.

**Boot order (a strict chain):** config.toml → the database container → `db init`/`migrate` (creates the
registry tables) → seed (write-if-absent) → `__config_sync.sh` renders the artifacts → services start and
resolve from the DB → the proxy serves. The DB must be up before the sync and every service.

**Forbidden edges (no loop deps):** config.toml must never be derived from the DB; the DB must never read
a service or an artifact; the sync must never write domain data (C1/D2); the seed is write-if-absent only.

**Hot-reload:** panel reads + service bindings — **hot** (5 s TTL) · exposures → sync + `nginx -s reload`
(near-hot) · tailnet name → recreate that node · TLS/new hostname → `./cms domain` · compose topology →
render + targeted `up -d` · DB connection/secrets → restart.

## Boundary
Untouched: `contests.is_active`'s panel path, the `container:control` key set, the tailnet authkey.
Verify on prod with `\d services` before step 1 (C5 assumes no stray `port` column).
