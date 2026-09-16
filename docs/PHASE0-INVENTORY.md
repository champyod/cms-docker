# Phase 0 — Inventory (single-backend plan)

Read-only audit preceding Phase 1. Everything downstream derives from this.
Source plan: `docs/PLAN-SINGLE-BACKEND.md`.

## Headline numbers

| Metric | Value |
|---|---|
| Mutating Python handlers | **55** across 11 of 16 modules |
| `@require_permission` applications | **95** |
| Operations that actually write the DB | **45** (10 do not) |
| **Multi-write operations** (need logical-operation endpoints, not CRUD) | **16** |
| Operations touching the blob store (`file_cacher`) | **6** |
| **Writing operations with NO panel API route** | **16** — the Phase 3 workload |
| Panel API routes | 28 |
| Panel server actions | **147, and none of them call an API route** — all write Prisma directly |
| Python template visibility decisions | 55 sites across 29 templates |
| Field-permission divergences between the two UIs | **10** |

## Finding 1 — Phase 1 (panel service layer) is not optional

All **147** panel server actions write Prisma directly; only two `fetch(` calls exist and both are
outbound. Nothing routes through the 28 API routes. So today "single source" would be true for the
Python admin and **false for the panel**. Phase 1 must extract one service layer that both the
actions and the routes delegate to, before any proxy work.

Note the one existing exception in the other direction: `submissions/[id]/route.ts` imports server
actions, i.e. the route delegates to the action layer. That direction is the pattern to generalise.

## Finding 2 — the audit chain does not cover the Python admin at all

The Python `AuditLog` model exists (`src/cms/db/permissions.py:124`, exported) but has **no
writer** — three grep hits, all model/export. Only the panel writes audit (`recordAudit`, ~29
files).

So "one audit source" is not a merge of two writers; it is that one side has never written audit.
Until Phase 6, every Python-side mutation is unaudited, and the hash chain silently excludes them.

## Finding 3 — the divergences the plan exists to eliminate

1. **`all:all` expands from two different universes.** Python expands from the DB `permissions`
   table (`base.py:176-179`); TypeScript from the registry constant (`permission-engine.ts:22-33`).
   Only the TS registry is guaranteed complete.
2. **Two incompatible `all:all` predicates inside Python itself.** `has_effective_permission`
   requires `len(effective) == 1` (`base.py:189-193`); `Admin.has_permission` grants on mere
   presence (`db/admin.py:62-71`). Every template gate uses the second one.
3. **Four+ "is superadmin" predicates** across both languages (`handlers/admin.py:42,180,186`,
   `base.py:196-221`, `admin-helpers.ts:43`, `rpc_authorization.py:73-75`, 11 template sites).
4. **Field-permission rule in three places** — `field-permissions.ts` (155 fields),
   `SELF_MODIFIABLE_FIELDS` (`admin.py:127-131`), template gates.
5. **`SELF_MODIFIABLE_FIELDS` conflicts with the TS map.** Python self-edit bypasses the check
   entirely (`self_allowed=True`) and allows editing `username`; the panel's
   `FIELD_PERMISSION_MAP.admins.username` has no `update` key, so `stripDisallowedFields` drops it
   — the panel can never do what Python allows, for any caller.
6. **Panel adds guards Python lacks** — `updateAdmin` blocks self-mutation, `deleteAdmin` blocks
   deleting yourself; `AdminHandler.delete` (`admin.py:226`) has no self-check.
7. **Three keys in play for one operation.** Dataset activation: Python `dataset:switch`, panel
   route `dataset:update`, field map `dataset:switch`.
8. **Panel write semantics differ even where a route exists** — no default dataset on task create,
   no sibling renumber on task delete, cannot change `username`/`preferred_languages`,
   forbids deleting the active dataset where Python permits it.

## Finding 4 — visibility divergences (the capability surface)

- **Nav shows what the page then denies**, 3 cases: `Appearance` gated `appearance:list` in the
  sidebar but `appearance:update` on the page; same for `Maintenance` and `Settings`.
- **Palette is a second nav source** (14 items) missing `Groups`, `Audit`, `Appearance`, plus a
  third computed subset (`palette-data.ts:54-64`).
- **Hide-vs-disable is inverted between UIs**: Python *disables* a visible Remove button
  (`teams.html:12`), the panel *filters the entry out*. These must agree.
- **Client-side capability computation** at ~11 sites (modals, `palette-data.ts`, `workers.ts`) —
  each is a place a UI decides for itself what to show.

## Finding 5 — validation inventory (Phase 4, after security)

- Python: parsing layer `handlers/base.py:72-165` and `:517-727`; per-handler rules (unique dataset
  description, `.pdf` statement + mandatory language, zip import errors); `assert`s for required
  arguments.
- TypeScript: `contest-validation.ts:89-143` (date ordering, numeric bounds, token cap), dataset
  limits, team code/name, user username/email/password, IP allowlist/CIDR.
- **Shared today only via DB constraints** — 17 named contest constraints mapped in
  `contest-validation-constraints.ts:2-19`.
- **Testcase limits: neither side has any** — only blob/DB errors. A rule to author, not port.

## Rulings on the audit's open questions

1. **Does the batch dispatcher count as "has a route"?** No. Parity means the *operation* is
   reachable with its full behaviour. Where the batch dispatcher covers only part of an operation
   (e.g. enrolment create/delete but not the full participation fields), it counts as **MISSING**.
2. **Do the session-only methods stay in the inventory?** No. `LoginHandler`/`LogoutHandler` are
   session management local to the Python UI; the panel has its own auth. They are not
   admin-domain operations and need no panel route.
3. **Is `file_cacher` the intended "large object" meaning?** Yes — it is the blob store backing
    the same database large objects the panel writes via `lo_from_bytea`. No S3/object storage is
    involved in these handlers.

## Known data issue — contest names with spaces (pre-existing)

`contest.name` is used as both a cookie name (`<name>_login`) and a URL path segment.
Whitespace is illegal in cookie-name tokens (RFC 6265), so any contest already stored
with a name containing spaces has a silently broken login cookie today, independent of
this refactor. The name rule `^[A-Za-z0-9_-]+$` was already enforced by the panel
service layer and is now enforced in the Python admin and batch importer; shipped
examples were fixed (`School Programming Championship` → `School_Programming_Championship`,
`24-Hour Marathon 2024` → `24-Hour_Marathon_2024`). Production data should be audited
for names outside that pattern and migrated (spaces → underscores or another safe
codename) before relying on contest login.
