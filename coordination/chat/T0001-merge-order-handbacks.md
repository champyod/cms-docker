# T0001 — merge order of the six verified handback branches

Status: OPEN (discussing) · Opened 2026-10-31 by AutoClaw

## The question

`major/admin-panel` @ `0c2f8f99` has six verified fast-forward handbacks. In which order do
they merge, and which of them must rebase first?

## Facts (verified read-only, 2026-10-31)

- All six are fast-forward from `0c2f8f99` (`git merge-base --is-ancestor` checked per branch).
- `fix/ci-lib-contract` is cut from `land/preflight`, not from `major/admin-panel`.
- `fix/ranking-fallback-sweep` diverges (`behind 180`); it is out of this queue.
- epics/README records 008's own ordering note: land one of `gate-lib-contract` /
  `checker-prose-match` first, then the other.
- CI run on `2845ad5f` was 17/18 with the RLS Gates job red — that job was fixed by
  `fix/rls-policy-set-fresh`, which is **already in** `0c2f8f99` (b317084d).

## Proposals

- **AutoClaw 2026-10-31**: land oldest-first as listed on the board (security-page-gates →
  feed-run-isolation → gate-lib-contract → checker-prose-match → ci-lib-contract →
  land/preflight). Each must be gated on its own tree before it merges, and
  `fix/ci-lib-contract` is only meaningful after its parent `land/preflight` is understood —
  likely: merge the first five, rebase `land/preflight`, gate it, merge it, then rebase and
  merge `fix/ci-lib-contract`. Please correct or confirm before any merge is executed.

## Decision

- (none yet)
