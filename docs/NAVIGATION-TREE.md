# NAVIGATION-TREE — cms-re-catalog (3 surfaces side by side)

Read-only audit. Markers: `[cms]` = `./cms` (bash + Rust CLI + Rust TUI) · `[panel]` = Next.js `admin-panel/` · `[py]` = vendored Python admin. `✗` = surface lacks the node.

Rule measured: **siblings reachable · back = parent (exactly one level) · home always reachable.**

## 1. Union tree (primary artefact)

```
HOME / Dashboard / Overview ─────────────────────────────── [cms][panel][py]
│   [cms]  TUI route Dashboard (tui/app/route.rs:5; key `1` tui/mod.rs:64)
│   [panel] /[locale] (app/[locale]/(authenticated)/page.tsx)
│   [py]   / (handlers/__init__.py:111)
│
├─ Contest
│   ├─ Contests list ─────────────────────────────────────── [cms~][panel][py]
│   │     [cms]  action-only: Stacks▸Deploy Contest (menus.rs:56);
│   │            System▸Create Contest (menus.rs:260); CLI `contest create`
│   │     [panel] /contests (sidebar-nav.ts:44) ▸ /contests/[id]
│   │     [py]   /contests (handlers/__init__.py:124) ▸ /contest/<id>
│   ├─ Tasks ─────────────────────────────────────────────── [✗][panel][py]
│   ├─ Submissions ───────────────────────────────────────── [✗][panel][py]
│   ├─ Users / Participants ──────────────────────────────── [✗][panel][py]
│   ├─ Teams ─────────────────────────────────────────────── [✗][panel][py]
│   └─ Contest scope (ranking|users|tasks|announcements|questions|submissions)
│                                                            [✗][panel][py] base.html:221-234
│
├─ Identity & authority
│   ├─ Admins / Superadmin ───────────────────────────────── [cms][panel][py]
│   │     [cms]  Bootstrap▸Create Superadmin (menus.rs:270); CLI `admin-create`
│   │     [panel] /admins (sidebar-nav.ts:53)
│   │     [py]   /admins — greeting link ONLY (base.html:71)
│   ├─ Groups ────────────────────────────────────────────── [✗][panel][✗ py]
│   ├─ Permissions ───────────────────────────────────────── [✗][✗][py assign-only]
│   └─ Overrides ─────────────────────────────────────────── [✗][✗][py assign-only]
│
├─ Infrastructure
│   ├─ Worker fleet ──────────────────────────────────────── [cms][✗][✗]
│   ├─ Stacks deploy / stop / clean / pull ───────────────── [cms][✗][✗]
│   ├─ Containers ────────────────────────────────────────── [✗][panel][✗]
│   ├─ Resources / service status ────────────────────────── [cms][panel][py]
│   ├─ Monitoring ────────────────────────────────────────── [cms][✗][✗]
│   ├─ Ranking ───────────────────────────────────────────── [cms~][panel][py]
│   ├─ Backups ───────────────────────────────────────────── [cms][panel][✗]
│   ├─ Maintenance / update ──────────────────────────────── [cms][panel][✗]
│   ├─ Domain / TLS / Funnel / Tailscale / Expose ────────── [cms][✗][✗]
│   └─ Config / Secrets ──────────────────────────────────── [cms][panel][✗]
│
├─ Appearance ────────────────────────────────────────────── [✗][panel][✗]
├─ Audit log ─────────────────────────────────────────────── [✗][panel][✗]
├─ Search ────────────────────────────────────────────────── [✗][panel*][✗]   (*URL only)
├─ Logs ──────────────────────────────────────────────────── [cms][panel~][✗]
├─ Documentation ─────────────────────────────────────────── [✗][panel][✗]
└─ Sessions (Login/Logout) ────────────────────────────────── [✗][panel][py]
```

## 2. Per-surface trees (where they diverge)

```
[cms] ./cms — TUI 10 flat sibling routes; menu entries are ACTIONS, not pages
Dashboard ─┬─ Stacks      (menus.rs:140)  ← Deploy/Stop/Clean/Pull × 5 stacks (menus.rs:52-138)
 (home,    ├─ Database    (menus.rs:147)
  key 1)   ├─ Worker      (menus.rs:156)  ← top-level, while admin/contest are NOT
           ├─ Ingress     (menus.rs:175)  ← includes Expose Wizard (menus.rs:188) ← BROKEN
           ├─ Config      (menus.rs:208)
           ├─ Backup      (menus.rs:244)
           ├─ System      (menus.rs:253)  ← Live Status, Monitor UI, Create Contest
           ├─ Bootstrap   (menus.rs:264)
           └─ Logs        (key 0/l)       ← auto-pushed after any capture_output action
Siblings: all 10 reachable from any page by number key (tui/mod.rs:64-101) ✅
Back: Esc → pop_route → parent (tui/mod.rs:58, app/state.rs:98) ✅   Home: key `1` ✅

[panel] Next.js — three INDEPENDENT hand-written nav lists + the route dirs (4 sources)
Sidebar (17, sidebar-nav.ts:29-62) │ Palette ⌘K (14, palette-data.ts:37-52) │ `g`-chord (10, useShortcuts.ts:17-28)
  Dashboard                          Dashboard                                (Dashboard path:'' key d)
  Documentation                      Documentation                            —
  Contest: Contests/Tasks/           Contests/Tasks/                          Contests/Tasks/Users/
    Submissions/Users/Teams            Submissions/Users/Teams                  Teams/Submissions
  Infrastructure: Active Contest     Active Contest                           Deployments ← label differs
    /Admins/Groups/Audit/Resources/    /Admins/Resources/Containers/            Resources/Containers/
    Containers/Ranking/Appearance/     Ranking/Maintenance/Settings             Settings
    Maintenance/Settings
  Missing from palette: Groups, Audit, Appearance
  Missing from `g`-chord: Docs, Admins, Groups, Audit, Ranking, Appearance, Maintenance, Search
Siblings ✅ (flat sidebar) · Back: NO in-app back control anywhere (0 hits) ✗
Home: sidebar Dashboard always visible ✅

[py] Python admin — nav hand-written in base.html; two DIFFERENT menus by context
  contest none → Overview /, Resource usage, Contests(+/add), Tasks(+/add),
                 Users(+/add), Teams(+/add)                              base.html:90-218
  contest set  → Overview(contest), Resource usage, General, Ranking, Submissions,
                 User tests?, Users, Tasks, Announcements, Questions    base.html:221-234
  Admins: reached ONLY through "Hello, <name>" greeting link (base.html:71)
  Back: h1.parent → url() = Overview ROOT, not the Contests parent (base.html:77-78) ✗
  Siblings: on a contest page the global Tasks/Users lists are unreachable ✗
  Home ✅ (base.html:77,90)
```

## 3a. Level & structure violations

| # | Surface | Violation | Evidence | Proposed general mechanism |
|---|---|---|---|---|
| 1 | panel | **No in-app Back at all**; `/contests/[id]`,`/tasks/[id]`,`/teams/[id]` have no parent link | 0 hits for `router.back\|history.back\|ArrowLeft\|onBack` | registry `parent` field; one `<BackLink>` renders it |
| 2 | panel | `/search` unreachable — in none of the 3 nav lists | `(authenticated)/search/page.tsx` | registry `exposeIn:['sidebar','palette','chord']` |
| 3 | panel | Palette ⊂ sidebar: Groups/Audit/Appearance sidebar-only | sidebar-nav.ts:54,55,59 vs palette-data.ts:37-52 | one list + per-surface filter |
| 4 | panel | 3rd divergent list; same route labelled "Active Contest" vs "Deployments" | sidebar-nav.ts:52 vs useShortcuts.ts:26 | single registry; label authored once |
| 5 | cms | **Worker promoted to top-level while peers admin/contest are buried** in the Stacks menu | route.rs:8 + tui/mod.rs:77 vs menus.rs:52-86 | catalog `group` field drives route set + menu nesting |
| 6 | cms | `cmd_usage()` (cms:29-78) and `usage()` (cms:135-151) have NO reachable call site — advertised command list is dead, drifting text | cms:127-129 execs run_tui for any arg | render `--help` from the Rust catalog |
| 7 | cms | `./cms expose` advertised (cms:60) but **linked-but-broken** | Expose→`__domain.sh`, ARGS_NONE (table_fleet.rs:91-98); no verb → usage + exit 1 (__domain.sh:827) | registry entry must carry its verb/args or be absent |
| 8 | py | `/admins` is an action (a name), not a sibling section | base.html:71 | section list generated from route metadata |
| 9 | py | On contest pages the server-level siblings (global Tasks/Users lists) vanish | base.html:219-235 has no `url("tasks")`/`url("users")` | render both levels from one registry with `scope` |
| 10 | py | "Back" jumps to root Overview, skipping the Contests parent | base.html:77-78 | registry `parent`; one back-links macro |

## 3b. Hardcoded — independent sources per fact

| Fact | Worst offenders (file:line) | Sources | Proposed mechanism |
|---|---|---|---|
| Container / service names | Makefile:151-152 · cms:298 (+ cms:303-306 probes) · `__smoke-test.sh`:424-427,448,458,465,487 · `__update-server.sh`:127,130,133 · `__restore.sh`:120-134 · docker-compose.yml:9,39,78,120,162,291,392,438,479 (+ .core/:9,36,71,109,147 · .admin/:12,54,80,106 · .contest/:12,44,75) · docker-compose.worker.yml:40-45 · config/prometheus/prometheus.yml:47 · `__nginx-proxy-render.sh`:46,80,121 · `__config_sync.sh`:410 | **≥12 files** | `stacks.toml`: `stack → {profile, services[], ports{}}`; all scripts resolve via one `__lib/stacks.sh` reader |
| Stack names core/admin/contest/worker/infra | docker.rs:4,7 · Makefile:69,83,97,111,125,142-180,224-248 · cms:42,56 · compose `--profile` | **≥5** | same `stacks.toml` |
| Health-check target list | cms:298 vs `__smoke-test.sh`:458,465 | 2 lists + compose | derive from `stacks.toml` |
| Ports 8888/8889/8890/8891 | cms:303-306 · `__smoke-test.sh`:475-480 · compose port maps · `__nginx-proxy-render.sh`:46,80,121 | **≥4** | one `ports.toml` consumed by all |
| Role literal `'Superadmin'` | handlers/admin.py:42,188-194 | ≥2 | permission registry constant |

## 3c. Non-templated (hand-written where a table should generate)

| Repetition | Count | Evidence | Proposed mechanism |
|---|---|---|---|
| Panel nav for ONE route set | **4 sources** (sidebar 17 · palette 14 · chord 10 · route dirs 18) | sidebar-nav.ts:29-62 · palette-data.ts:37-52 · useShortcuts.ts:17-28 · `app/**/page.tsx` | one `nav-registry.ts` (path,label,icon,group,permission,exposeIn); surfaces render filtered views |
| TUI page wiring per page | **5 places/page** (route enum · render fn · pages/mod.rs match · key arm · drawer/refresh arm) | route.rs:4-15 · pages/mod.rs:16-28 · tui/mod.rs:64-101 · state.rs:52-63,111-139 | `PAGES: &[PageDef{route,key,label,render}]` iterated for keys+mounts |
| TUI menu labels duplicate catalog `about` | 8 menus, ~60 literals | menus.rs:147-272 vs catalog/table.rs:9-190 | render menus from `catalog()` grouped by `CommandSpec.group` |
| Compose service definitions | 9 services × 4 files | docker-compose.yml ↔ .core/.admin/.contest/.worker.yml | `extends`/`include` |
| py nav hand-written per context | 2 menus, 16 links | base.html:88-241 | generate from HANDLERS metadata (label,group,scope) |

## 4. Missing / unreachable inventory

**Implemented but unreachable**
- panel `/search` — page exists, zero nav references.
- panel `Groups`, `Audit`, `Appearance` — sidebar-only, missing from palette **and** `g`-chord.
- panel `Documentation` — missing from `g`-chord.
- panel `Admins/Groups/Audit/Ranking/Appearance/Maintenance` — missing from `g`-chord.
- panel `users` has **no** detail route while contests/tasks/teams do (`unverified` whether modal-only).
- py `/admins` — reachable only via the greeting name (base.html:71).
- `./cms expose` — reachable but **broken**: binds to `__domain.sh` with no verb → usage + exit 1.
- `./cms` `cmd_usage()` / `usage()` — dead text (cms:29,135).

**Expected but not implemented**
- py: **no Groups / Permissions / Overrides CRUD** — CONFIRMED, no such routes in HANDLERS. Models + assignment exist; Groups appear only as a read-only column (admins.html:16,31,48-49). No groups.html.
- py: no worker / monitoring / backup / domain / appearance / audit UI.
- panel: no worker page, no monitoring page, no domain/TLS/funnel page, no stack stop/clean/pull action.
- `./cms expose` access-mode wizard (no `expose` verb in any script).

## 5. Command surface matrix (owner-suspect items)

| Command | [cms CLI] | [cms TUI] | [panel] | [py] |
|---|---|---|---|---|
| `stop` / `clean` / `pull` | ✅ cli/commands.rs:48-50 | ✅ Stacks menu (menus.rs:88-138) | ✗ | ✗ |
| `status` | ✅ table.rs:91-99 | ✅ System▸Live Status | ✅ /resources | ✅ base.html:91 |
| `monitor` | ✅ table.rs:100-108 | ✅ System▸Monitor UI | ✗ | ✗ |
| `contest create` | ✅ cli/mod.rs:211-215 | ✅ System▸Create Contest | ✅ palette | ✅ base.html:124-130 |
| `worker …` | ✅ cli/mod.rs:189-198 | ✅ Worker page (menus.rs:156) | ✗ | ✗ |
| `expose` | ✅ but broken | ✅ but broken | ✗ | ✗ |

## 6. Answer to the level-inversion question

**"Can you reach worker from a page where contest/admin siblings are not reachable?"**

- `[cms]` CLI **YES.** `./cms worker …` is a top-level subcommand (cli/mod.rs:189-198) while `admin` is *not* (only `deploy admin` cli/mod.rs:134-140 and `admin-create` :164). Worker is reachable where the admin sibling is not.
- `[cms]` TUI **YES.** `Worker` is a top-level route (route.rs:8, key `4`) reachable from every page, while `Admin`/`Contest` exist only as entries inside the Stacks menu (menus.rs:52-86). **The owner's suspicion is confirmed.**
- `[panel]` **NO — inverse.** No worker route exists at all, while Contests and Admins *are* siblings. The defect is absence, not level.
- `[py]` **NO — inverse.** No worker concept; Contests is a section and Admins is an action.

## 7. Corrections to the original brief

- The health-check list is `cms:298`, not `cms:281`.
- `__smoke-test.sh` service lists are at :458, :465, :487 (the brief's :477/:484 are port defaults).
- `Makefile:151-152` confirmed exactly as described.
