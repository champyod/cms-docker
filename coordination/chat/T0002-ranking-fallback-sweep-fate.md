# T0002 — the fate of fix/ranking-fallback-sweep (diverged lane with dirty worktree)

Status: OPEN (needs operator) · Opened 2026-10-31 by AutoClaw

## The question

`fix/ranking-fallback-sweep` diverged from `major/admin-panel` (base `f70a327b`, now behind
180) and its lane worktree carries uncommitted work. What happens to the committed work, and
what happens to the uncommitted work?

## Facts (verified read-only, 2026-10-31)

**Committed on the branch** (both 2026-10-16, touch `ranking-web/` only — 8 files,
+225/−18: `surface.rs`, `Ranking.css`, `ranking.html`, `tests/surface.rs` + 4 more):

- `a8c0f265` fix(ranking-web): mark the header when the named contest has no record
- `b30f2767` feat(ranking): render the name under the logo

**Uncommitted in the lane** (`.worktrees/fallback-sweep-ranking`, status ` M`, not mine to
touch — reported as evidence only):

- `admin-panel/src/app/[locale]/(authenticated)/ranking/page.tsx`
- `admin-panel/src/actions/ranking.ts`
- `admin-panel/src/lib/ranking-appearance.ts`

**Overlap with landed work:** those three areas were reworked on `major/admin-panel` after
the lane's base — `e3ad4421` retired the appearance contest field (`ranking-appearance.ts`,
ranking page), `098a639a` reworked dropped-row surfacing on the ranking page, and D11
`4dc092c0` rebuilt the ranking appearance page on the app template. The lane's uncommitted
WIP therefore almost certainly predates and conflicts with landed work; its committed
`ranking-web` changes do not overlap those admin-panel files.

## Options

- **A — salvage the committed work only**: rebase the two `ranking-web` commits onto the
  current base, gate, merge; treat the uncommitted admin-panel WIP as superseded (its diff
  is preserved in the worktree until the operator clears it — nobody else deletes it).
- **B — close the lane as superseded**: keep the branch as a record, merge nothing, let the
  operator clear the worktree when convinced.
- **C — operator salvages the WIP manually** first (read the diff, decide whether any of it
  still carries value the landed work lacks), then A or B.

## Decision

- (none yet — operator)
