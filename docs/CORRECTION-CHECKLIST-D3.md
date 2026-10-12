# Correction — D3 in IMPLEMENTATION-CHECKLIST-RANKING-SCOPE.md

**Status:** supersedes the D3 section of `IMPLEMENTATION-CHECKLIST-RANKING-SCOPE.md`.
That file cannot be edited directly (see "Why this is a separate file" below).

## What was claimed

Section 2 of the checklist marks D3 `DONE` and ticks three boxes, including:

> - [x] Panel: a warning card on `Ranking → Board` when either counter is non-zero,
>       linking to the override list.

## What is actually true

**The panel warning card was never implemented.** That box was ticked in error. The
route half was done; the panel half was not, and the checkbox overstated the work.

Corrected status for D3:

| Part | Status | Evidence |
|---|---|---|
| `GET /diagnostics` in the Rust service | **DONE** | `ranking-web/src/http.rs`; `tests/diagnostics.rs`, 2 tests |
| A consumer for the counters in the panel | **NOT DONE** | no reference to `diagnostics` or `skipped` exists in `admin-panel/src` |

## Why the panel half was not simply finished here

The panel has **no HTTP path to the ranking service** at all. Verified:

- No `RANKING_URL` / `CMS_RANKING_*` reference exists anywhere in `admin-panel/src`.
- The only cross-service precedent is `evaluation-rpc.ts`, which reaches the
  evaluation service over a raw socket on a hardcoded host (`cms-evaluation-service`,
  port 25000) and reads `RPC_SECRET` from the environment.
- `admin-panel/src/lib/evaluation-rpc.ts` is itself guard-blocked (it contains the
  `RPC_SECRET` read), so it is not a path that can be extended from here.

Adding the card therefore needs, first, a decision that the panel may address the
ranking host and under which hostname — a deployment question, not a code question.

## What finishing D3 actually requires

1. Decide the ranking hostname the panel may use (the compose service is
   `ranking-web-server`; the panel already knows that name in
   `lib/compose-command.ts:63` and `lib/restart-service-scope.ts:23`), plus the port.
2. Add a small fetch helper for `GET /diagnostics` alongside the existing
   service-access code, and a permission key gating it — `ranking:read` already exists
   and is the right one.
3. Render the warning on the `Ranking → Board` page (`ranking/page.tsx`, which is
   writable) when either counter is non-zero.
4. Test the refusal path: an unreachable service must render as "unknown", never as a
   clean board. That mirrors the route's own contract — it refuses rather than
   reporting zeros, so the panel must not turn a refusal back into zeros.

Item 3 alone is a small edit; items 1-2 are the real work and item 1 is a decision.

## Why this is a separate file

`IMPLEMENTATION-CHECKLIST-RANKING-SCOPE.md` contains five lines matching the workspace
write guard's credential pattern (it quotes `pub session_secret: Option<String>` and the
`"savedPassword"` dictionary line as evidence), and any write to it is refused. Rather
than leave a known-false checkbox in the canonical handoff, the correction is recorded
here and this file is the one to trust for D3.

## Updated tally

With D3 corrected, the honest count at tip `f2b5b467` is:

| Task | Status |
|---|---|
| D1 `freeze` | DONE, verified (6 tests) |
| D2 panel half | DONE; service half BLOCKED (guard) |
| D3 route | DONE, verified (2 tests) |
| D3 panel card | **NOT DONE** (needs the host decision above) |
| M1 route half | DONE; label BLOCKED (guard) |
| M2 ranking out of Communications | DONE |
| M3 board + selector | DONE |
| S1 submission filters | DONE, verified (8 tests) |
