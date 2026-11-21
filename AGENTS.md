# AGENTS.md — CMS Docker (major/admin-panel checkout)

> Project rules for AI agents working in this checkout. Coordination first: read
> `coordination/PROTOCOL.md` and `coordination/BOARD.md` before editing anything.

## Cross-agent coordination

This checkout is written by multiple agent CLIs. Every agent must:

1. Read `coordination/PROTOCOL.md` (board + chat rules) at session start.
2. Claim the files it will touch on `coordination/BOARD.md` **before** editing them.
3. Never edit a file another agent's row declares. Overlaps go to `coordination/chat/`.
4. Commit policy: quick `WIP:` commits while building, one logical full commit per epic
   (no WIP left), per the operator's decision of 2026-10-31 recorded in `coordination/PROTOCOL.md`.

## Authority

- `CLAUDE.md` is the architecture and pattern law of this codebase.
- `TODO-DEV.md` and `epics/` (hub root) are the durable backlog and decision record.
- The landing branch is `major/admin-panel`; nothing lands there unverified.
