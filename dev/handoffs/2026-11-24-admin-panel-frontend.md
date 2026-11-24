# Handoff: admin panel frontend system

Date: 2026-11-24
Worktree: `/mnt/Dev/Coding/Repos/CMS-Hub/.worktrees/rust-trunk-reconcile`
Branch: `feat/rust-trunk-reconcile`, cut from `origin/feat/backend-rust`
Landing branch for this work: `feat/rust-trunk-reconcile`
Shared index warning: another writer is committing backend/grading work in this same worktree.
Treat their commits as read-only and stage only explicit paths.

## Goal

Three layers, one source of truth each:

1. Tokens: colour, type, radius, density, motion.
2. Shell and page archetypes: the frame plus a small set of page templates that own layout and slots.
3. Pages: every page instantiates an archetype and supplies facts, never layout.

DONE WHEN:

- Every page declares its archetype and carries no bespoke layout.
- Every fact comes from the archetype's slot list and the page inventory.
- No status colour on non-status text, enforced by a gate.
- No raw control that has a primitive, enforced by a gate.
- Type scale, density modes and focus ring enforced by a gate.
- Light, dark, high contrast and both densities measured on every rebuilt page.

## Status against DONE WHEN

| Item | Status | Evidence |
|---|---|---|
| Page declares an archetype | done | `design:archetypes`: 76 declared, 0 undeclared of 76 pages |
| Facts from the slot list | done at inventory level | `design:inventory`: 53 of 53 |
| Status colour only for status | gate green, debt being reduced | `design:colour`: 223 uses in 105 files; baseline 321 |
| Raw controls use primitives | gate green, debt 228 | `design:controls` |
| Type scale, density, focus ring | done | `design:usage`, `design:token-coverage`, `design:modes` |
| Four modes, both densities | token level done; pixel level blocked | needs an authenticated browser harness and a fixture server |

## What landed in this frontend session

| Commit | Scope |
|---|---|
| `2414c1f6` | Task empty state reads `tasks.contestTasks.empty`; Thai test added and falsified |
| `150d6ca0` | Ranking table and timezone menu empty states read the dictionary |
| `b6eb65ff` | Contest list empty state reads `contests.list` |
| `7813116f` | Comment blocks collapsed across 161 Hermes-touched frontend files; comment-only proof 161/161 |
| `b5fee371` | Commit-message gate: subject at most 50 characters, no filler, no first person, no trailer; 7 tests |
| `f347d6d0` | `BoardSectionBody` union: `rows` or `empty`, never both; `boardSection` helper; 13 sections migrated |
| `fda8b5b2` | Status-colour baseline ratcheted from 370 to 347 |
| `4964d5e3` | `AdminList` renders both status pills through `Badge`; words from `admins.*`; debt 347 to 338 |
| `8d73166f` | Epic S12 record updated to 338 |
| `a4bd22bd` | `DeployStatusPanel` phase badge through `Badge`; debt 338 to 325 |
| `8e3758d2` | Epic S12 record updated to 325 |
| `b6a0ba5e` | `StatsCard` colour only state counts; total and uptime neutral; debt 325 to 321 |
| `b5a0f015` | This handoff document |
| `d630bf93` | Commit-message gate rejects process facts in bodies |
| `c236a230` | `ContainerRow` state and Platform tag through `Badge`; debt 321 to 313 |
| `c646bcc8` | Docs submission callouts go neutral; debt 313 to 305 |
| `67e2897c` | `TestcasePairsList` pair ids through `Badge`, labels neutral; debt 305 to 297 |
| `c74aafaf` | `DatasetsSection` actions use `Button`, state uses `Badge`; debt 297 to 280, raw controls 238 to 232 |
| `240f22a5` | `taskColumns` contest chip through `Badge`; task link uses underline; debt 280 to 277 |
| `e39f32ee` | `ContestParticipantsSection` chips through `Badge`; avatar neutral; debt 277 to 271 |
| `7dffec50` | `DatasetScoreParamsEditor` view switcher through `Tabs`; debt 271 to 264, raw controls 232 to 229 |
| `ca97bb91` | `ContestRosterSection` state through `Badge`; avatar neutral; debt 264 to 258 |
| `a5e10c98` (merge) | `ContestTasksSection` task avatar neutral; debt 258 to 256. Swept into the grading lane merge; see Incident. |
| `9797365c` | `ContainerRow` name hover and Reset link stop using primary; debt 256 to 253, raw controls 229 to 228 |
| `a10ca5db` | `RankingOverrideForm` queued chips are neutral; debt 253 to 249 |
| `03d49755` | `WorkerNodeRow` log toggle stops using info; debt 249 to 247 |
| `ba3c8ff8` | `task-modal-extra` token labels stop using primary; debt 247 to 245 |
| `643d6075` | `task-modal-extra` selected format and language use foreground; debt 245 to 242 |
| `35d89de9` | `task-detail-sections` statement icon muted, language filter selected foreground; debt 242 to 239 |
| `428a7b80` | `ContainerSettingsModal` restart icon and normal count stop using primary; debt 239 to 237 |
| `7581ecfd` | `QuestionsPanel` reply block is neutral content; the reply action keeps its tested tint; debt 237 to 235 |
| `dab20f09` | `TeamMembersTab` avatar and contest labels neutral; link hover foreground; debt 235 to 230 |
| `66df5f88` | `AppearanceClient` section icons and service keys stop using primary; debt 230 to 227 |
| `a5291f20` | `NetworkTrafficLogs` RX/TX and header icon stop using status colours; debt 227 to 223 |

Backend commits by another writer are interleaved: `947168fc`, `bd6b8ba1`, `11e28781`,
`52818b79`, `9f4564b5`. Do not touch them.

## Current step

S12, status-colour debt reduction, one component at a time. The latest measured count is
223 uses in 105 files, and `admin-panel/scripts/status-colour-baseline.json` is 223.
The epic `docs/design/epic-frontend-system.md` now records 313.

Top remaining offenders:

| File | Uses |
|---|---|
| `src/components/containers/ContainerRow.tsx` | 11 |
| `src/components/ui/button.tsx` | 8 |
| `src/components/submissions/SubmissionResultsTab.tsx` | 7 |

Note: some of these are legitimate status uses on status words. The gate allows status
primitives only; a stat card or an action button that carries a semantic colour needs a
decision, not a blind colour removal.

## Leftover, in detail

- **Pixel-level measurement is blocked.** It needs an authenticated browser session, a
  fixture server, and a new dev dependency. That is an operator decision.
- **S12 is not zero.** 223 uses in 105 files. The gate holds the line but the debt is real.
- **Epic S12 record is stale.** It says 325; the measured count is 321.
- **Epic lives under `docs/`.** `docs/` is end-user only by the workspace rule; this
  maintainer epic belongs under `dev/`. Moving it is a separate file-structure step.
- **Four unhandled happy-dom errors remain** in `tests/header-palette-focus.test.tsx` and
  `tests/palette-switch-deploy.test.tsx`: `AbortError: The animation was canceled`. They
  pre-date the frontend changes and were not touched. Full suite still reports 398 files /
  5163 tests passed.
- **Shared index.** Another writer is active in this worktree. Before every commit, run
  `git diff --staged --name-only` and confirm only your paths are present. Prefer
  `git commit -F <msg> -- <explicit paths>` so another writer's staged work cannot ride along.
- **Commit-message gate is active in this worktree only.** `core.hooksPath` is set in
  `.git/worktrees/rust-trunk-reconcile/config.worktree`. Other checkouts need their own
  activation.

## Commit-message correction

The subject form is correct. The bodies of the recent UI commits still carry process facts:
preview dimensions, debt deltas, gate counts. Those belong in this handoff or the epic, not
in the commit body.

Correct body: the reason the change exists, and only when it is not obvious from the subject.
Example for `StatsCard`:

    refactor(stats): colour only state counts

    A stat card that is not a state count taught colour as decoration, which weakens the
    one place colour carries meaning.

Do not put `Preview at 900px`, `Status-colour debt: 325 to 321`, `tsc 0`, or test counts in
the body.

## Preview rule

Preview by impact type:

- UI, anything the reader sees: render at real width, light and dark.
- File structure, added or moved files: tree and shape, not code.
- Implementation: diff for logic with no visible effect or a small effect with wide blast radius.
- None: dead code, comments, behaviour-preserving renames.

A preview without its situation (where it lives, what the reader is doing) is not a preview.

## Reproduce the gates

From `admin-panel/`:

    bunx tsc --noEmit
    bun run design:check
    bun scripts/__check_status_colour.mjs
    bunx vitest run

From the worktree root:

    git diff --staged --name-only
    git show -s --format=%B HEAD | bun admin-panel/scripts/__check_commit_message.ts

## Next concrete step

Pick one S12 file, not the class. Recommended first: `ContainerRow.tsx` because its 19 uses
split cleanly into status (container state, restart limit) and decoration (selected row,
reset link, Discord toggle). Render a light and dark preview of the row before committing.
If the next writer prefers a smaller blast radius, start with `TestcasePairsList.tsx`.

## Skills and standing rules

- Skill rules outrank repository precedent at any granularity, including existing code and
  past commits. Change the code, never weaken the rule.
- Load `clean-code`, `impeccable`, `git-master`, `commit-discipline` and `caveman-commit`
  before editing or committing.
- One topic per form; never bundle a class of changes into one review.
- One writer per index; explicit-path staging; no `git add .`.
- Comments are one terse WHY line; license and copyright headers are exempt.
- Commit subject at most 50 characters; lowercase imperative after the colon; no period.

## Incident

`a5e10c98` is the merge of lane `feat/rust-S5e3a2-archive` into this
branch. Two admin paths were staged in the index when that merge was
committed, so they landed inside it: `ContestTasksSection.tsx` and
`status-colour-baseline.json`. The code is correct and the gates pass,
but the commit message names only the grading lane. No history rewrite
was attempted; the next agent should not amend or rebase it without the
operator.
