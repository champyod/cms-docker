# Implementation Checklist — Ranking Scope & Panel Fixes

> **Branch:** `feat/ranking-scope-panel-fixes` (from `major/admin-panel`)
> **Purpose:** a successor agent must be able to pick this up cold. Every task carries
> its status, the exact files, and how to verify it. Update `Status` in place as you work.
>
> **Status vocabulary:** `TODO` · `WIP` · `DONE` · `BLOCKED` · `DROPPED`

---

## 0. Environment constraints (read before starting)

| Tool | Available? | Consequence |
|---|---|---|
| `cargo` 1.98.1 | yes | `cd ranking-web && cargo test` works — the Rust suite is the primary gate |
| `bun` 1.4.2 | yes | `cd admin-panel && bun run test` (vitest) works |
| `docker` | **no** | `ranking_e2e.sh` **cannot** run; do not claim E2E verification |
| `psql` | **no** | no live-DB verification; Prisma migrations cannot be applied here |

**Baseline before any change:** `cargo test` → **21 passed**. Panel `vitest` → 2668/2668
per `RANKING-STATUS.md`. Re-run both after every task and compare.

> **Do not mark anything DONE on the strength of "it compiles."** The suite must pass.

---

## 1. Corrections to the earlier roadmap (read this — it changes task priority)

The first roadmap (`docs/ADMIN-PANEL-FEATURE-ROADMAP.md`) overstated two things. This
document supersedes them.

### C1 — D2 severity was overstated. It is a **latent** bug, not a live cross-contest leak.

I wrote that "a `hide` filed on contest 1 hides that user on every contest's board."
That is only reachable if **two contests share one ranking service**, and the push path
prevents exactly that:

- `ProxyService` is bound to a single contest (`ProxyService.py:269` → `self.contest_id`).
- It refuses any submission from another contest (`ProxyService.py:504-508`):
  *"this ProxyService considers contest %d only"* — and likewise for tasks
  (`ProxyService.py:591-595`).

So one ranking service = one contest, and the projection tables hold **one** contest's
rows. The `contest_id` column on `ranking_overrides` is therefore *effectively constant*.

**What is still genuinely wrong:** the panel presents a **contest selector** that has no
effect on behaviour, and the reader (`overrides.rs:205`, `overrides.ts:31`) ignores the
column entirely. An operator is invited to believe they are scoping an override when they
are not. That is a real defect of *meaning*, not of isolation — and it becomes a true leak
the moment a multicontest deployment points several contests at one ranking instance.
Fix it, but describe it accurately.

### C2 — D2's premise was also incomplete: the contract has no contest dimension at all.

`ranking_projection.py` writes a `contest` column on `ranking_tasks`
(`COLUMNS["tasks"]` includes `"contest"`), but there is **no** `contest` column on
`ranking_submissions` or `ranking_subchanges`, and the Rust reader never selects it
(`store.rs:214` is `SELECT key, score_mode FROM ranking_tasks`). Delivering a genuinely
per-contest board is therefore a **schema + push-path change**, not a query tweak.

**Decision taken:** do not attempt a per-contest board in this patch. Scope the
overrides to the service's own contest (which is what the column was for) and leave the
board single-contest, which matches the push path. Recorded as **DROPPED-1** below.

---

## 2. Defects

### D1 — `freeze` is a dead option `TODO`

**Evidence**
- Offered: `RankingOverrideForm.tsx:118`
- Stored: `rankingOverrides.ts:15` (`OVERRIDE_ACTIONS` includes `'freeze'`)
- Described: `dictionaries/en.json:234` (`actionFreeze`)
- **Ignored:** `ranking-web/src/overrides.rs:15-19` defines only
  `HIDE/GUEST/PIN/RENAME/SCORE`; the match at `overrides.rs:133-141` falls through to
  `_ => false`, which increments `skipped`.

**Also note:** `VALUE_CONTROLS` in the form (`RankingOverrideForm.tsx:41-47`) has **no
entry for `freeze`** either, so the value field silently falls back to text.

**Chosen resolution:** implement it properly (the user selected this option).
**Semantics to implement:** `freeze` carries a cutoff time. Subchanges whose `time`
exceeds the cutoff are not replayed, so the board shows the standing as of that instant.

- [ ] `overrides.rs`: add `ACTION_FREEZE`, a `frozen_at: Option<i64>` on `Overrides`,
      and `fold_freeze` parsing the payload's `value` as an i64.
- [ ] `overrides.rs`: add `pub fn frozen_at(&self) -> Option<i64>`.
- [ ] `scoring.rs`: thread the cutoff into `replay_subchanges`, skipping
      `change.time > frozen_at`.
- [ ] `RankingOverrideForm.tsx`: add `freeze` to `VALUE_CONTROLS` as
      `{ type: 'number', inputMode: 'numeric' }`.
- [ ] Tests: freeze hides later subchanges; freeze with a malformed value is skipped
      rather than panicking; absent freeze replays everything.

**Verify:** `cd ranking-web && cargo test overrides` and a new freeze test in the
`scoring` module. A frozen board must equal the board with the later subchanges deleted.

### D2 — Overrides ignore the contest the panel asks for `TODO`

**Evidence**
- Collected: `rankingOverrides.ts:52-54` refuses a save with no contest.
- Stored: `ranking_overrides.contest_id`.
- **Ignored on read:** `rankingOverrides.ts:31-35` → `where: { active: true }`.
- **Ignored by the service:** `overrides.rs:205-212` → `WHERE active ORDER BY id`.

- [ ] `config.rs`: read `RANKING_CONTEST_ID` (i64, optional) alongside the other
      `RANKING_*` settings.
- [ ] `overrides.rs`: `load_overrides(pool, contest_id: Option<i64>)`, filtering
      `AND ($1::int IS NULL OR contest_id = $1)`.
- [ ] `store.rs`: pass the configured contest through both `load_overrides` call sites
      (`store.rs:75`, `store.rs:153`).
- [ ] `rankingOverrides.ts`: filter the read by the selected contest id.
- [ ] Tests: an override for contest A is absent when loading contest B; a null contest
      id loads everything (back-compat for single-contest installs).

**Verify:** `cargo test overrides`; add a panel test that `getRankingOverrides` passes
the contest filter through.

### D3 — The skipped counters are computed and never shown `TODO`

**Evidence:** `scoring.rs:19-20,38-43,161-162` computes `skipped_subchanges` and
`skipped_overrides`. Grepping `http.rs`, `surface.rs`, `public_config.rs` and
`templates/` finds **no consumer**.

- [ ] `http.rs`: add a `GET /diagnostics` route returning
      `{ ready, skipped_overrides, skipped_subchanges }` via `state.standings()`.
- [ ] Panel: a warning card on `Ranking → Board` when either counter is non-zero, linking
      to the override list.
- [ ] Test: the route refuses rather than reporting zeros when there is no database —
      an empty board and an unreadable store must not look alike.

**Verify:** `cargo test diagnostics`.

---

## 3. Move ranking out of the Communications tab

**This is the user's primary request.** Ranking is currently the **third tab of
Contest → Communications**:

- `useContestCommunications.ts:9` → `CommTab = 'announcements' | 'questions' | 'ranking'`
- `ContestCommunications.tsx:36,52` → renders `RankingTable`
- `contest-communications/RankingTable.tsx` + `useContestCommunications.ts` do the work

**Target:** ranking becomes its own top-level tab in the Contest record, beside Overview /
Tasks / Participants / Communications. Announcements and Questions keep the Communications
tab; ranking leaves it.

### M1 — Route and tab registration `TODO`

- [ ] `lib/navigation/types.ts`: add `'contests.tabs.ranking'` to the `RouteId` union.
- [ ] `lib/navigation/registry-competition.ts`: add `contests.tabs.ranking` to the
      `recordRoute(...)` `tabIds` for `contests.record`, and a `tabRoute` descriptor at
      `/contests/[id]/ranking` with `{ all: ['contest:read', 'ranking:list'] }`.
      **Note:** the existing ranking read in the tab uses `getRanking`, which requires
      `ranking:list` — reuse that key, do not invent one.
- [ ] `contests/[id]/layout.tsx`: add a `case 'contests.tabs.ranking'` to
      `getContestTabLabel`.
- [ ] Create `app/[locale]/(authenticated)/contests/[id]/ranking/page.tsx`.
- [ ] `dictionaries/en.json` **and** `th.json`: add
      `navigation.contests.tabs.ranking.label` (en: "Ranking"; th: "การจัดอันดับ").
      Every route descriptor resolves its label and **throws** when a key is missing
      (`shell-nav.ts:resolveLabel`), so a missing translation is a page crash.

### M2 — Remove ranking from Communications `TODO`

- [ ] `useContestCommunications.ts`: narrow `CommTab` to `'announcements' | 'questions'`;
      drop the `ranking` state, the `getRanking` import, and the `ranking` branch in
      `load`.
- [ ] `ContestCommunications.tsx`: drop the ranking tab button and the `RankingTable`
      branch.
- [ ] Decide `RankingTable.tsx`'s fate: move it under `components/contests/contest-detail/`
      for the new tab, or keep it and re-point the import. Do not leave it orphaned.
- [ ] Tests: `contest-detail-parity.test.tsx` and any Communications test assert the tab
      set — update them.

### M3 — Make `Ranking → Board` show an actual board `TODO`

**Finding:** the page at `/ranking` renders appearance metadata and the logo card only
(`ranking/page.tsx:41-63`). It does not draw a board. With ranking now a contest tab,
give the global page a purpose or demote it.

- [ ] Decide: contest selector + live board, or fold it into the Ranking group as
      "settings only". Record the decision here before implementing.
- [ ] If a board is added, reuse `RankingTable` rather than writing a second renderer.

---

## 4. Explicitly DROPPED (so a successor does not re-derive this)

### DROPPED-1 — Per-contest board in the Rust service

Schema + push-path work: `ranking_submissions` and `ranking_subchanges` have no contest
column (`ranking_projection.py:35-38`), and `store.rs:214` does not select the one that
exists on tasks. Not in this patch. Revisit only as part of a deliberate multicontest
design, together with `ProxyService`'s one-contest binding.

### DROPPED-2 — E2E verification of any of this

No docker and no psql in this environment. `ranking_e2e.sh` stays unrun. Say so in the
handoff; do not imply otherwise.

### DROPPED-3 — Submission filters (S1) and the evaluation/re-eval spine (E1/V1/V4)

Out of scope for this branch by the user's selection. They remain in
`docs/ADMIN-PANEL-FEATURE-ROADMAP.md` §3 and §4.

---

## 5. Handoff protocol

When you stop — whether finished or not — leave the repo in a state a successor can trust:

1. Update every `Status` in this file. No task may stay `WIP` without a note.
2. Run both suites and paste the real counts into §6 below.
3. Commit in logical steps; do not leave the tree dirty.
4. State plainly which tasks are `DONE` and **which are unverified**. A task whose only
   evidence is "it compiles" is `WIP`, not `DONE`.

---

## 6. Verification log

Filled in by the implementing agent. Append, do not overwrite.

| When | Task | Command | Result |
|---|---|---|---|
| baseline | — | `cd ranking-web && cargo test` | 21 passed, 0 failed |
| | | | |
