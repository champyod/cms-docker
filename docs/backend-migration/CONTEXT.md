# Context

## What this repository is

Contest Management System (CMS) is an infrastructure platform for running programming contests
and training camps. This repository is a fork of the upstream CMS project, wrapped in a
containerized deployment with a Next.js administration panel and an operational toolchain.

The baseline for this document set is the branch `feat/backend-rust`, cut from
`feat/requirements-catalog` at `b6103ed9`. Every citation is a path relative to that tree, and the
load-bearing citations were re-checked against it. The branch exists so this analysis is versioned
independently of the other worktrees, which kept moving while it was written:
`feat/requirements-catalog` advanced from `8ff4ce7f` to `b6103ed9`, and the branch-to-worktree
assignments changed twice.

## The fork model

Two remotes are configured in `.git/config`:

| Remote | Target | State |
|---|---|---|
| `origin` | the fork repository | fetched normally |
| `upstream` | `cms-dev/cms` | configured, never fetched |

The upstream relationship is the defining constraint of this work:

- The Python core under `src/` is a **plain copy, not a submodule**. There is no `.gitmodules`,
  no `src/.git`, and no `.git/modules/`; nothing under `src/` has its own history.
- **No upstream pin is recorded.** The checkout cannot answer "what changed versus upstream".
  A re-sync requires a manual upstream fetch and a tree comparison.
- The best-supported base is an upstream commit after the v1.5.1 tree; the vendored
  `src/cms/__init__.py` reports version `1.6.dev0`.

Details and the recorded last-sync commits are in `docs/FORK-SUMMARY.md`.

## What the fork adds (not upstream at all)

Deployment and operations artefacts sit alongside the vendored source:

| Area | Contents |
|---|---|
| Root | `Dockerfile`, `Makefile`, the `cms` launcher, `config.toml.example`, twelve `docker-compose*.yml` files, `CLAUDE.md` |
| `admin-panel/` | Next.js administration panel (TypeScript, Prisma, React) |
| `scripts/` | shell operations, TUI helpers, SQL application and coverage gates |
| `config/` | nginx, fail2ban, Grafana, ModSecurity, Prometheus, Tailscale, Vault overlays |
| `tools/` (in the TUI worktree) | Rust `cms-tui` operational CLI and dashboard |

## What the fork patches in the vendored Python

Only three areas of the vendored tree differ from upstream:

1. **Evaluation queue fairness** — a new fairness column and a delay computation in the
   evaluation service.
2. **Admin permissions** — the admin web server and its templates migrated to the forked group
   and per-person permission model.
3. **Ranking branding** — a configurable logo path and a hot-swappable `/logo` route in the
   ranking web server.

Everything else — the common library, packaging, the bulk of the services, web servers, grading,
languages, and task types — is byte-identical to upstream. The fork summary records the exact
boundary.

## The cost of replacing the Python core

This is the single largest cost of the work and it must be weighed against every benefit in
`MIGRATION-OPTIONS.md`.

- **Upstream is a live project.** It carries thousands of commits of accumulated behaviour and
  ongoing releases. The vendored copy is already behind its own base and unpinned.
- **Merge-ability is forfeited permanently.** Today an upstream fix can be adopted by fetching
  upstream and comparing trees. Once the Python core is replaced, there is no upstream tree to
  compare against: every upstream fix must be re-implemented by hand, or the fix is abandoned.
- **Behavioural parity is a specification problem, not a translation problem.** The Rust backend
  must independently reproduce semantics that were never written down — they exist only as
  Python. The inventory in `INVENTORY.md` is the first attempt to write them down.
- **The contestant-facing surface is the highest-risk area.** The contest web server and the
  ranking web server are what participants actually use. Any behavioural drift there is visible
  to contestants during a contest.

Nothing in this document set selects a migration strategy. The options, their costs, and their
blast radius are enumerated in `MIGRATION-OPTIONS.md`; the decision belongs to the human owner.

## The confirmed plan this work sits beside

A user-confirmed plan already exists on this baseline branch and is being implemented:
`docs/PLAN-SINGLE-BACKEND.md`, with its audit at `docs/PHASE0-INVENTORY.md` (committed at
`8ed54dd5`). It sets a target that is the **opposite** of the Rust task documented here.

| | Confirmed plan (`PLAN-SINGLE-BACKEND.md`) | This document set (Rust task) |
|---|---|---|
| Where backend logic lives | The Next.js panel becomes the only write backend | A Rust backend; the panel holds none |
| Python admin | Becomes an API client of the panel API | Replaced, along with the other services |
| Security rules | Single source in TypeScript, generated into Python | Re-implemented once in Rust |
| Upstream cost | Accepted: 55 rewritten handlers conflict on sync | Full forfeiture of upstream merges |

The two need not be mutually exclusive in time: the confirmed plan can be read as an intermediate
stage that consolidates all writes into one layer before any move to Rust. But as end-states they
contradict each other, and no decision has been recorded about which wins. That decision is OQ-00
in `OPEN-QUESTIONS.md`. Nothing in this set overrides the confirmed plan.

## How to read this document set

| Document | Question it answers |
|---|---|
| `CONTEXT.md` | What is this fork, and what does leaving the Python core cost? |
| `INVENTORY.md` | What exists today, and where does it live? |
| `REQUIREMENTS.md` | What must the replacement do, testably? |
| `THREAT-MODEL.md` | What must not break, and what threatens it? |
| `ARCHITECTURE.md` | What would the replacement look like, and what happens to each invariant? |
| `MIGRATION-OPTIONS.md` | How could the move be made, and at what cost and risk? |
| `OPEN-QUESTIONS.md` | What remains unresolved and needs a human decision? |
