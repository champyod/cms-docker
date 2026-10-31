# Board — live work items

> Source of truth: this file. One row per live item. Declare the files you will touch
> **before** you edit them. Overlapping claims must go to `chat/` before either agent edits.
> Statuses: `planning` | `in-flight` | `verify` | `merge` | `done`.

## Landing branch

`major/admin-panel` — verified `origin/major/admin-panel` = `0c2f8f99` on 2026-10-31 22:23 +0700.
Local `major/admin-panel` was re-pointed to it (old tip preserved as
`backup-major-pre-009-20261031` @ `9b4df0ef`; both carry the same patch-id `a4a8eb98`).

## Verified handbacks (source: epics/README.md 2026-10-29 tick + re-verified 2026-10-31)

Six branches verified fast-forward from `0c2f8f99` — **merge queue, one at a time, oldest first:**

| Branch | SHA | Status | Merged? |
|---|---|---|---|
| `fix/security-page-gates` | `05bb2edc` | verify — gate-green | no |
| `fix/feed-run-isolation` | `763c7d3a` | verify — gate-green | no |
| `fix/gate-lib-contract` | `c1fdc31c` | verify — gate-green | no |
| `fix/checker-prose-match` | `ca26613e` | verify — gate-green | no |
| `fix/ci-lib-contract` | `a59fba79` | verify — cut from `land/preflight` | no |
| `land/preflight` | `30ff924d` | verify — umbrella gate | no |

`fix/ranking-fallback-sweep` is **not** in the queue: it diverges from `0c2f8f99`
(re-checked 2026-10-31). It needs its own thread before it can merge.

## Live items

| # | Item | Lane / checkout | Branch | Agent | Declared files | Step | Status |
|---|---|---|---|---|---|---|---|
| 009.1 | coordination board + chat (this system) | `cms-docker-major` | `major/admin-panel` | AutoClaw | `coordination/**`, repo `AGENTS.md` (hub-root records live outside any repo) | committed as one full epic commit | done |
| 009.2 | point `CLAUDE.md` at the coordination protocol (one section + TOC line) | `cms-docker-major` | `major/admin-panel` | (unassigned) | `CLAUDE.md` | blocked — write guard flagged the file's pre-existing `AUTH_SECRET=` doc placeholder (empty value, env-var example, line ~1086); operator must rule it a false positive before any CLI edits that file | blocked |

## Notes

- 009.2 is the only wiring missing: repo `AGENTS.md` covers opencode and any AGENTS.md reader,
  hub `AGENTS.md` covers AutoClaw. Command Code reads `CLAUDE.md`, so it sees the protocol only
  after 009.2 lands.
