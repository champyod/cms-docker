# Coordination protocol — CMS-Hub board + chat

> Read this before touching anything else in this repo. It tells you how the agents work
> together, and it applies to **every agent**: opencode, commandcode, AutoClaw, hermes-agent.

## Why this exists

This repo is written by several agent CLIs at once. Two failure modes cost real time:

1. **Two agents edit the same file** and the second overwrite silently wins — work is lost.
2. **Two features land in an order** that makes the later one have to undo and redo work.

This directory is the single place where agents agree on both. It is git-tracked, so every
write is a commit, every commit is attributed, and a wrong claim is visible in the diff.

## The board

`BOARD.md` is the source of truth for **who is doing what right now**:

- One row per **live work item**: the item's id, the lane/checkout it runs in, the branch,
  the agent doing it, the **declared files** it will touch, the current step, and status.
- **Files to touch must be declared before they are edited.** If another agent's row already
  declares a file you need, stop: it is an overlap. Do not edit. Resolve via chat.
- Statuses: `planning` → `in-flight` → `verify` → `merge` → `done`, plus `blocked` (why,
  in the row). Anything not listed here is not being worked on.
- The file is owned by whatever agent last touched it: the **Owner** column names that agent.
  Update your own row when your state changes; leave everyone else's rows alone.
- Overlap (same file declared twice): the later claimer backs off and opens a chat thread.

## The chat

`chat/` holds one numbered thread per coordination question, in append-only order:

- `T000N-<slug>.md` — the discussion; append by editing. In the body, put your agent name and
  a timestamp above what you write. Never rewrite or delete another agent's entries. If a
  thread is stale (marked `RESOLVED` at the top), open a new one; do not edit the old one.
- Open one thread when two agents' work **overlaps or must order** — for example, one feat
  must land before another, or both touch the same file, or a decision changes a planned
  interface. Move implementation forward only after the thread says `RESOLVED` with a decision.
- `next-thread`: the highest `T000N` in `chat/` plus one. Do not reuse a number.

## Commits while this protocol is active

The operator's chosen commit policy for work under this setup (2026-10-31) overrides the
default one-commit-per-step rule for this work:

- While building an epic, commit **WIP** partials quickly: `WIP: <type>(<scope>): <subject>`.
  Keep each WIP small and coherent so any two agents' work can rebase or merge cleanly.
- When the epic's logic is complete, commit it as **one logical full commit** containing the
  finished state, with a body that names the WIP commits it replaces. No WIP left on the branch.
- History is the tree: one full commit per epic on the landing branch; WIPs exist only inside
  an agent's own lane until they are folded.

## Landing branch

`major/admin-panel`. Anything merged here must be fast-forward or a clean merge of a gated
lane. See hub-root `AGENTS.md` and `TODO-DEV.md` for the rest of the rules; this file only
adds coordination.
