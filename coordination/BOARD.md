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
| R1 | diverged lane `fix/ranking-fallback-sweep` (committed ranking-web work) + its dirty worktree (3 uncommitted admin-panel files) | `.worktrees/fallback-sweep-ranking` (read-only for all agents — another writer's lane) | `fix/ranking-fallback-sweep` | (nobody — evidence only) | **none — read-only**; uncommitted evidence: `ranking/page.tsx`, `actions/ranking.ts`, `lib/ranking-appearance.ts` | awaiting T0002 decision (rebase-and-merge vs superseded vs operator salvages WIP) | blocked |
| H1 | `/login` is a dead end: `proxy.ts` prefixes the locale onto any path, but the page lives at `[locale]/auth/login`, so `/login` and `/en/login` both 404 (proven over HTTPS 2026-11-01: `/` → 307 → `/en/auth/login` = 200 with the form; `/login` → `/en/login` = 404) | `cms-docker-major` | `major/admin-panel` (cut after `0c2f8f99`) | hermes-agent | `admin-panel/src/proxy.ts`, `admin-panel/tests/proxy-auth-alias.test.ts`, `coordination/BOARD.md` | landed `32082e3e`; local gate green (360 files / 4366 tests, tsc 0, six CI Gate scripts OK); CI 42455524161 | verify |
| S1 | **security line — handed off 2026-11-08.** No further work from hermes-agent. Carried: (a) Trivy red `CVE-2026-78661` (`x/net` in the bundled Compose gobinary) needs a waiver row + `cd admin-panel && bun run scripts/security-waivers.ts export` + commit — the export also goes stale on **2026-11-23** (30-day gate); (b) nightly `image-scan.yml` is absent from `main`, so its `cron` never registers and it has **never run**; (c) feed verified **RUNNING** on como-main — last rootfs scan 2026-11-08 03:04, 31,368 findings in 126 batches, `complete=true`, every POST `201`; (d) C1/C2/C3 security-page candidates stay operator-gated | `land/security` lane (held by another agent, `d38194db`) + operator | `land/security` | hand-off recorded | handed off |

### Decision-gated candidates (no work starts until the operator picks a method)

| # | Item | Files (likely) | Waiting on |
|---|---|---|---|---|
| C1 | per-family concealment on the two security pages | security pages + route gate | operator decision (named 2026-10-27, epics 006 follow-up) |
| C2 | the expired-waiver card's meaning | security overview page + dictionary | operator decision (named 2026-10-27, epics 006/007 follow-up) |
| C3 | `recordAudit`'s error swallow | `admin-panel/src/lib/…` audit path | operator decision (named 2026-10-27, epics 007 follow-up) |
| C4 | 009.2 CLAUDE.md wiring | `CLAUDE.md` | operator's false-positive ruling on the `AUTH_SECRET=` doc line |

## Notes

- 009.2 is the only wiring missing: repo `AGENTS.md` covers opencode and any AGENTS.md reader,
  hub `AGENTS.md` covers AutoClaw. Command Code reads `CLAUDE.md`, so it sees the protocol only
  after 009.2 lands.
| H2 | expired/absent session on a protected page renders a 500 (`MissingDbActorError`, digest 1743905006) instead of redirecting — Next renders page+layout in parallel, so the layout's redirect cannot stop a child query | `.worktrees/session-gate` | `fix/session-gate` (cut from `807a5bd6`) | hermes-agent | `admin-panel/src/proxy.ts`, `admin-panel/tests/proxy-session-gate.test.ts`, `admin-panel/tests/base-path.test.ts`, `admin-panel/tests/auth-signout.test.ts`, `coordination/BOARD.md` | landed; 362 files / 4387 tests, icons 18/18, six CI Gate scripts OK | verify |
