# Plan — single write backend, panel as API, Python admin as client

Decisions taken (user-confirmed):

1. **Two navigation trees, explicit boundary.** Operator console (`./cms` CLI + TUI) is separate
   from the web admin UIs. Operator tree holds host-level power (stacks, worker, domain/TLS,
   monitoring, secrets, backups); the web-admin tree is permission-checked (contests, tasks,
   users, teams, identity). Shared nodes are marked explicitly. The web UIs never grow
   host-level pages.
2. **Panel sidebar groups into sections** (Contest / Identity / Infrastructure / System) so that
   "back one level" has a level to return to. Today it is flat and Back can only mean "go home".
3. **`stacks.toml` becomes the single source** for stacks, services and ports. Every script, the
   Makefile, the health checks and the TUI read it through one `__lib/stacks.sh`; a gate fails if
   `docker-compose` drifts from it. Removes the >=12 hardcoded copies of service names.
4. **The Next.js panel is the only write backend.** The Python admin becomes an API client:
   all 55 mutating handlers across 16 modules rewritten to call the panel API.
5. **Shared rules: security first, then validation.** Permission keys, the resolver
   (groups + overrides, deny-wins, `all:all` expansion), field-level access and the superadmin
   predicate are generated from TypeScript into Python before domain validation follows.
6. **Python admin: compatibility only.** No new features; all new features land in the panel.

## Accepted risk

`src/cms/**` is vendored as plain copied files (no `.gitmodules`, no recorded upstream pin).
Rewriting 55 handlers and 95 permission guards makes every rewritten hunk a merge conflict on
any future upstream sync. This was raised and accepted; it is a consequence of decision 4, not
an open question.

## Sequencing

**Phase 1 — panel API reaches parity.** The panel has 28 routes; the Python admin has 55 mutating
operations. The API must cover every operation before anything can proxy to it. Enumerate the 55,
map each to a panel route, implement the missing ones. Nothing else can start until this is done.

**Phase 2 — shared security rules, generated.** Single source in TypeScript
(`permission-registry.ts` + `permission-engine.ts` + `field-permissions.ts`). Generate the Python
equivalents. One gate fails on mismatch. This is the phase that makes drift impossible.

**Phase 3 — Python handlers become clients.** One module at a time, never in bulk. Each module:
replace the direct DB write with an API call, keep the template and route unchanged, verify the
same behaviour end-to-end through the real Python admin UI, commit.

**Phase 4 — drift gate.** Assert no Python handler writes the DB directly. The gate is the
guarantee; without it the two layers grow back.

## Preconditions before Phase 3

- Phase 1 complete: no operation exists in Python without a panel route.
- The panel API is reachable from the Python admin container, with service-to-service auth
  (the RPC shared secret already established).
- Failure modes defined: what the Python admin shows when the panel is down. Today a Python
  handler failing its DB write is a local error; after the change the panel is a network
  dependency on the admin's critical path.

## Open items unchanged by this plan

- Two TUI files still exceed the 250-line limit (`action_menu.rs`, `menus.rs`).
- The TUI dashboard still renders hardcoded service data with an unbound refresh key.
- `./cms expose` is linked but broken (binds to `__domain.sh` with no verb).
- `make lint` fails on a pre-existing shellcheck `SC2066` in `__smoke-test.sh:319` — a real bug:
  the loop iterates one quoted string, so it runs once regardless.
- Admin panel: 10 duplicate list pages, 18 independent modals, 623 permission-key literals,
  four navigation sources, no in-app Back.
