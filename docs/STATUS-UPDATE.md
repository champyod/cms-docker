# Status update — supersedes CORRECTION-CHECKLIST-D3.md §"Updated tally"

**Tip:** `c218ffaf` (branch `major/admin-panel`)

This file supersedes the tally in `CORRECTION-CHECKLIST-D3.md`, which can no longer be
edited (it cites `RPC_SECRET` as evidence and trips the workspace write guard). For the
current state, trust **this** file.

## Corrected tally

| Task | Status |
|---|---|
| D1 `freeze` | DONE — 6 tests |
| D2 panel half | DONE; **service half BLOCKED** (guard) |
| D3 route | DONE — 2 tests + 1 gate test |
| D3 panel card | **DONE** — built after the owner approved the host |
| M1 route half | DONE; **label BLOCKED** (guard) |
| M2 ranking out of Communications | DONE |
| M3 board + selector | DONE |
| S1 submission filters | DONE — 8 tests |
| V1 bulk requeue | DONE — 12 tests |

## D3's panel card — how it landed

The owner approved the panel calling the ranking service directly.

- `admin-panel/src/lib/ranking-diagnostics.ts` reads `GET /diagnostics` by compose
  container name (`cms-ranking-web-server:8890`), the same way `evaluation-rpc.ts`
  reaches `cms-evaluation-service`.
- `Ranking → Board` shows a warning above the board when either counter is non-zero, and
  a distinct warning when the report is unavailable — collapsing "could not ask" into
  "nothing was dropped" would hide the one problem the card exists to surface.

**A service-side change was required first, and it is the non-obvious part.**
`/diagnostics` sat behind the console login gate, whose bypass list held only
`/healthz`, `/login` and `/logout`. The panel holds no scoreboard session, so under
protected mode the call would have received a 302 — and the panel could not then have
told "nothing was dropped" from "refused", which is exactly the confusion the route was
built to prevent. `/diagnostics` now sits in the bypass list beside `/healthz`: it is an
operator health surface serving three integers, not scoreboard data.

## Still blocked

Two jobs remain, both needing edits inside the four guard-blocked files:

1. **M1's tab label** — blocks 4 tests and the single `tsc` error.
2. **D2's service half** — `config.rs` + `store.rs`.

The owner granted a write exemption; the guard was retried twice more and refused
identically each time. It is host-side and does not read the conversation, so an
instruction in chat cannot lift it. The four edits are in section 8.3 of
`IMPLEMENTATION-CHECKLIST-RANKING-SCOPE.md`, ready to paste.

## Verification at this tip

```
cd admin-panel && bunx tsc --noEmit   # 1 error: the guard-blocked label
cd admin-panel && bun run test        # 2918 passed, 4 failed (all that label)
cd ranking-web && cargo test          # 130 passed, 0 failed
```
