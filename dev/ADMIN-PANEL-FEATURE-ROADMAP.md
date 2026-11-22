# Admin Panel — Feature Roadmap: Evaluation, Ranking, Submission, Re-evaluation

> Survey basis: `cms-docker-major` @ `major/admin-panel` (checked out, clean tree).
> Panel: Next.js 16 / React 19 / Prisma 6, 203 test files, 67 permission keys.
> Ranking service: Rust/axum in `ranking-web/`, reading `ranking_*` projection tables.
> Every item below is anchored to code that exists today, not to a hypothetical stack.

---

## 0. Read this first — three defects found while surveying

These are not new features. They are live inconsistencies on the exact surfaces you
asked about, and two of them make the ranking override console silently wrong today.

### D1 — `freeze` is a dead option in the override form (silent no-op)

The panel advertises and stores a `freeze` action, and the service ignores it.

| Layer | Evidence | Behaviour |
|---|---|---|
| Dictionary | `dictionaries/en.json:234` → `"actionFreeze": "freeze the shown score"` | Operator sees the option |
| Form | `components/ranking/RankingOverrideForm.tsx:118` | Option is selectable |
| Action allow-list | `app/actions/rankingOverrides.ts:15` → `['hide','guest','pin','rename','score','freeze']` | Row is written to the DB |
| Service | `ranking-web/src/overrides.rs:15-19` defines only `HIDE/GUEST/PIN/RENAME/SCORE`; `overrides.rs:133-141` matches those five with `_ => false` | **Row is skipped and counted as `skipped`** |

So an operator can pick "freeze the shown score", get a success toast and an audit
row, and the board does not change. Fix by either implementing the arm (recommended —
see R2) or removing `freeze` from the allow-list, the form and the dictionary.

### D2 — Ranking overrides are not contest-scoped, though the UI asks for a contest

`ranking_overrides.contest_id` exists, and the form makes the operator choose one:

- `RankingOverrideForm.tsx:69-78` renders a required `contestId` select.
- `rankingOverrides.ts:52-54` refuses a save without a contest.
- `rankingOverrides.ts:31-35` reads back with `where: { active: true }` — **no contest filter at all.**
And the service cannot scope them either — `overrides.rs:205-212`:

```sql
SELECT target_kind, target_key, action, payload->>'value' AS value
FROM ranking_overrides WHERE active ORDER BY id
```

The folded `Overrides` struct (`overrides.rs:83-95`) has `hidden` / `renamed` / `scored`
/ `pinned` keyed only by target, with no contest dimension. Consequence: a `hide` filed
against contest 1 hides that user on **every** contest's board. The panel collects a
scope it then discards.

This matters more than it looks, because it is the same axis as the strategic question
in §5 — ranking is already per-contest everywhere else (`ranking.ts:87-99`,
`ranking.ts:182-193`), so this is the one place the scope axis was dropped.

### D3 — Silent-drop counters are computed but never surfaced

`ranking-web/src/scoring.rs:19-20,38-43,161-162` computes `skipped_overrides` and
`skipped_subchanges` (rows the folder refused rather than blacking out the board —
a deliberately forgiving design). Grepping `http.rs`, `surface.rs`, `public_config.rs`
and `templates/` finds **no consumer**. The forgiving behaviour is right; the
invisibility is not. A dashboard tile "3 overrides not applied" turns D1 from a silent
no-op into a visible one.

---

## 1. Evaluation

| # | Feature | Why it is worth having | Anchor | Effort |
|---|---|---|---|---|
| E1 | **Promote lanes from audit rows to a real table** | Lane state is derived by scanning the 2000 newest `audit_log` rows and taking the latest lane verb per submission (`evaluation-lanes-board.ts:14`). That is a correctness cliff at scale: once 2000 newer audit rows exist, an older live assignment disappears from the board. Keep audit as history; add a `evaluation_lane_assignments` current-state table. | `evaluation-lanes-board.ts`, `LANE_AUDIT_SCAN_LIMIT = 2000` | M |
| E2 | **Lane workload & throughput dashboard** | Per-lane queue depth, average dwell time, submissions/hour, and who is over capacity. Waiting counts are already computed (`countPendingByUserDb` / `countQueuedByUser`), so the data exists — only the aggregation and the view are missing. | `evaluation-lanes-board.ts:38-40` | M |
| E3 | **Queue position and ETA** | Today the `queue_status` RPC yields a count only (`QUEUE_STATUS_RPC_ENDPOINT`, `QUEUE_RPC_TIMEOUT_MS = 5000`, `evaluation-lanes-board.ts:15-16`). Contestants and admins both want "position 14, ~6 min". | `evaluation-lanes-board.ts:15-16` | M |
| E4 | **Shard & sandbox inspector** | `evaluations.evaluation_shard`, `evaluation_sandbox_paths`, `evaluation_sandbox_digests` are populated but have no dedicated surface. Show which shard/sandbox ran each testcase and flag digest drift between re-runs. | `prisma/schema.prisma` → `model evaluations` | M |
| E5 | **Per-testcase result heatmap** | A grid of testcase × dataset outcome instead of a wall of rows — the fastest way to see "fails only on large inputs, only on dataset 2". | `evaluations.outcome`, `submission_results` | S |
| E6 | **Annotated compilation log viewer** | `compilation_stdout` / `compilation_stderr` / `compilation_text` exist; add syntax highlighting, error extraction, and a "copy as report" affordance. | `model submission_results` | S |
| E7 | **Re-evaluation lineage view** | `compilation_tries`, `evaluation_tries`, `scored_at` record that a submission was scored more than once, but nothing shows the sequence. Render submission → attempts → outcome. | `model submission_results` | S |
| E8 | **Live evaluation log tail (SSE)** | SSE plumbing already ships for containers, resources and notifications. Reuse it to stream evaluation-service output into the panel instead of polling. | `api/containers/stream`, `api/resources/stream`, `api/notifications/stream` | M |
| E9 | **Manual score override with reason + dual approval** | Ranking already enforces "a contest, a target and a reason are required" (`rankingOverrides.ts:48`). `submission_results.score` / `public_score` / `score_details` can be edited with nowhere near that discipline. Bring the same rule to scoring, plus a second approver for final scores. | `model submission_results`, `rankingOverrides.ts:48` | M |
| E10 | **"View as contestant" preview** | `tasks.feedback_level` decides what a contestant sees; there is no way to preview it. A read-only impersonation of the contestant view catches feedback leaks before they ship. | `model tasks` → `feedback_level` | S |

## 2. Ranking

| # | Feature | Why it is worth having | Anchor | Effort |
|---|---|---|---|---|
| R1 | **Contest-scoped overrides + dry-run preview** | Fixes D2 and then goes further: before publishing, show "this hides 1 row", "this renames 4 rows", "this changes 3 scores". Load overrides with their `contest_id` and fold per contest. | `overrides.rs:205`, D2 | M |
| R2 | **Real scoreboard freeze (ICPC-style), time-bounded** | Implements the arm D1 promises, and makes it a first-class control: freeze from `stop` to `analysis_start`, unfreeze with one action, show a "frozen since" banner. `analysis_enabled` / `analysis_start` / `analysis_stop` already exist on `contests`. | D1, `model contests` | M |
| R3 | **"What changed" board changelog** | Score events already recompute and publish only changed pairs. Surface that stream as a readable changelog ("12:04 — team X 340 → 360, task C accepted"), which is what an operator needs during a live contest. | `ranking-web/src/score_events.rs` | S |
| R4 | **Team board and per-task board in the panel** | The service ships `/board` and `/board/teams` (`http.rs:38-39`) but `components/ranking/` has no team or per-task view — the panel links the board and stops there. | `ranking-web/src/http.rs:31-45` | S |
| R5 | **Board time-machine scrubber** | `ranking_subchanges` carries `time` and `score` per submission. A slider that replays "board as of T" is a natural fit for awards disputes and editorial write-ups. | `model ranking_subchanges` | M |
| R6 | **Embedded live board preview** | Render the real board inside the panel with a contest selector, so an override can be judged without switching to the public URL. | `ranking-web/templates/ranking.html` | S |
| R7 | **Medal boundary editor with live projection** | How many gold/silver/bronze, and where the cut lands right now. Pure presentation-layer arithmetic over the existing board, high value at ceremony time. | `ranking-web/src/board.rs` | S |
| R8 | **Anomaly detector for the board** | Flag a score jump with no matching subchange, a user who is `hidden`/`guest` but still affecting ranks, and duplicate team keys. Directly surfaces the *effect* of D1/D2/D3 to a human. | `ranking-web/src/scoring.rs`, D1-D3 | M |
| R9 | **Logo/sponsor asset manager with history** | Logo upload already hot-swaps with no restart (`POST /api/ranking/logo`, cache-bust via `?ts`). Add versions, scheduled swap at contest boundaries, and one-click revert. | `api/ranking/logo/route.ts` | S |
| R10 | **Real contestant/team images** | `/faces/<user>` and `/flags/<team>` serve a bundled dummy for *any* key — an entity with no photo and an unknown key are indistinguishable. The panel now has `api/ranking/avatars/[user]`, so finish the job: upload, crop, and an explicit fallback policy. | `api/ranking/avatars/[user]/route.ts`; `RANKING-STATUS.md` → "Images" | M |
| R11 | **Frozen snapshot export (PNG / PDF / CSV)** | A board captured at a fixed timestamp, for the awards deck and the official archive. CSV export also makes disputes auditable offline. | `ranking_*` projections | S |
| R12 | **Overrides that expire, with blast-radius preview** | Every override already stores `reason`, `created_by`, `ended_at`, `ended_by`, and `active` — the model is good. Add `expires_at` and show "affects N rows" before commit, so a forgotten `hide` cannot outlive the contest. | `model ranking_overrides` | S |
| R13 | **Multi-contest health console** | One list of every contest's board: last event received, participant count, projection lag, drift vs `submission_results`. Today each contest must be opened individually. | `ranking_contests`, `getRanking(contestId)` | M |

## 3. Submission

| # | Feature | Why it is worth having | Anchor | Effort |
|---|---|---|---|---|
| S1 | **Wire up the filters the backend already supports** | `getSubmissions` accepts `contestId`, `taskId`, `userId` (`people-read-models.ts:200-204`), but the page parses only `page`, `sort`, `dir` (`evaluation/submissions/page.tsx:47-50`). The filtering capability exists and is unreachable — the highest value-per-line item in this document. | `people-read-models.ts:200`, `submissions/page.tsx:47` | S |
| S2 | **Saved filter views** | "Contest 3 / task 5 / official only" should be a named, shareable bookmark, not four URL edits. | S1 | S |
| S3 | **Search across submissions** | Extend the existing search surface to hit submission id, comment, username and task name; the search page and palette already exist. | `app/actions/search.ts` | M |
| S4 | **Bulk operations on a filtered set** | Re-evaluate, set official, download, tag — for a selection. Today every action is one row at a time (`SubmissionActionBar.tsx:118-128`). Mirrors the batch infra that already exists for users (`api/users/batch`, `api/users/bulk`). | `SubmissionActionBar.tsx` | M |
| S5 | **Tags and reason codes** | Why was this submission re-evaluated? A small closed vocabulary makes the audit log queryable by intent instead of by timestamp. | `model submissions` → `comment` | S |
| S6 | **Download bundle with manifest and digests** | `downloadSubmissionFiles` exists; add a manifest naming the dataset, active dataset id, and per-file digest, so a downloaded archive proves what it contains. | `app/actions/related-reads.ts`, `fsobjects` | S |
| S7 | **Similarity / duplicate-solution review queue** | `files` / `fsobjects` are content-addressed, so identical and near-identical source is already cheap to detect via `fsobjects` digests. Plagiarism review is a normal contest requirement and the data is sitting there. | `model files`, `model fsobjects` | L |
| S8 | **"Needs attention" triage queue** | One queue for compilation failures, wall-clock timeouts (`execution_wall_clock_time` against limits), and memory outliers. Beats scanning the list by eye during a live round. | `model evaluations` | M |

## 4. Re-evaluation

| # | Feature | Why it is worth having | Anchor | Effort |
|---|---|---|---|---|
| V1 | **Batch re-evaluation over a filter** | `recalculateSubmission` is strictly single-submission (`submissions.ts:79`). Re-scoring a task after a checker fix is currently N manual clicks. This is the single most-requested shape of "re-eval" and it does not exist. | `submissions.ts:79` | L |
| V2 | **Job model with progress, cancel and retry** | `invalidateViaRpc` has a 10 s timeout and reports `accepted` / `timedOut` with **no retry** (`lib/evaluation-rpc.ts:20,44-52`). A runner adds bounded retry with backoff and a per-item outcome list. | `lib/evaluation-rpc.ts` | M |
| V3 | **Dry-run impact preview** | Before committing: "N submissions, M evaluations, K ranking events will change." Cheap to compute from the same filter, and it prevents the classic "I re-ran the whole contest by accident". | V1 | S |
| V4 | **Two-phase recompute so a lost request is recoverable** | `recalculateSubmission` calls the RPC first, then `clearRecalculatedTables` deletes rows (`submissions.ts:92,100`; the deletes are at `:148-158`). If the service dies between accept and completion, the rows are gone with nothing to retry from. Add a `queued → in-flight → done` state so an interrupted re-eval is detectable and resumable. | `submissions.ts:148` | M |
| V5 | **Mandatory reason + preset codes for recompute** | Lane moves already demand a reason (`evaluationLanes.ts:42,80`); recompute does not. Same discipline, same audit quality. | `evaluationLanes.ts:42` | S |
| V6 | **Dataset-switch re-eval wizard** | Changing `tasks.active_dataset_id` (with its `SetNull` on delete) silently invalidates existing scores. A wizard that lists affected submissions and offers to re-score them closes a real footgun. | `model tasks` → `active_dataset_id` | M |
| V7 | **Scheduled / automatic re-evaluation** | A scheduler already runs (`src/scheduler/` with `runner.ts`, `tick.ts`, `lockout-alerts.ts`). Add rules like "nightly re-score of compilation failures" or "re-score on dataset publish". | `src/scheduler/` | M |
| V8 | **Ranking propagation check** | After a batch, verify the public board equals the recomputed scores: compare `ranking_subchanges` against `submission_results.score`. Catches "the re-eval worked but the board never noticed". | `ranking_subchanges`, `submission_results` | M |

## 5. Cross-cutting admin ergonomics

| # | Feature | Why it is worth having | Anchor | Effort |
|---|---|---|---|---|
| X1 | **Audit hash-chain verification** | `audit_log` is already tamper-evident via `entry_hash` / `prev_hash` (`lib/audit.ts:155-174`), but `AuditDetail.tsx:55-62` only *displays and copies* the hash. A "verify integrity" job that walks the chain and reports the first break turns a nice property into a usable control. | `lib/audit.ts:155`, `AuditDetail.tsx:55` | S |
| X2 | **"Why can't I see this?" explainer** | With 67 permission keys, a subtly wrong group is hard to debug. Given a route, show which key denied it — derivable from `ROUTE_REGISTRY` and the group grants. | `lib/permission-registry.ts`, `permission-groups.ts` | M |
| X3 | **Reviewable config import/export** | Overrides, ranking settings and notification config as a diffable file, so a change can be reviewed before it is applied — the same spirit as the existing audit-before-write discipline. | `ranking_settings`, `ranking_overrides` | M |
| X4 | **Consolidate the two lockout surfaces** | `ranking/lockouts` (Redis console counters) and `security/blocks` (banned addresses, login lockouts, server login lockouts) answer the same question in two places. One page with scoped tabs removes a "which one do I unlock in?" trap. | `rankingLockouts.ts`, `securityBlocks.ts` | S |

---

## 6. The strategic question: should ranking move into "community"?

You asked whether ranking belongs somewhere else — into a *community* place. Today
there is no community or organisation concept anywhere in the panel: a grep for
"community" across `admin-panel/src` returns nothing, and the navigation registry has
eight fixed groups (`lib/navigation/registry.ts:31-40`) with `ranking` as one of them
(icons for those groups live in `components/navigation/shell-nav.ts:41-70`).

The honest framing is that "community" is not a *place to move ranking to* — it is a
**new scope axis**, and you already need one.

### Why the axis is already half-built

- Ranking is per-contest everywhere it works: `getRanking(contestId)` filters
  `ranking_tasks` and `ranking_submissions` by `contest_id`, and
  `ranking.ts:182` states plainly: *"Each contest is ranked on its own, so two contests
  in one deployment cannot share a board."*
- `ranking_contests` is a first-class projection table with `begin` / `end` /
  `score_precision`.
- The **one** place the axis was dropped is the override fold — defect **D2**.

So the board is already scoped; overrides are the outlier. A community layer is the
natural generalisation of a boundary that exists in spirit and is missing in one spot.

### Three options

| | Option | What it means | Trade-off |
|---|---|---|---|
| **A** | **Community as a real scope layer** (recommended) | Add a `communities` entity above contests. Ranking gets a community-scoped board and a public route (`/c/<community>`); contests belong to a community; overrides are scoped `community → contest → target`. Panel group becomes **Community → Ranking** with the contest selector folded into it. | Largest change, but it is the only option that makes the existing per-contest rule *enforced* rather than *assumed*. It also fixes D2 as a side effect instead of patching it. |
| **B** | **Community as a view only** | Keep ranking global; add a community filter and a `/c/<community>` vanity route that is pure presentation. | Cheap and low-risk, but leaves D2 intact and creates a second, weaker notion of scope that will drift from the first. |
| **C** | **Move ranking out to its own surface** | Ranking becomes a separate product/route, like a public results portal, no longer a panel group. | Real separation of concerns — but note that the panel's ranking pages are *control* surfaces (overrides, lockouts, credits, logo, appearance), not the board itself. Splitting the console from the board would leave the controls orphaned. |

### Recommended sequence

Do not start with the community table. The cheap, load-bearing order is:

1. **D1, D2, D3** — make the existing override console honest. D2 is the scope work, and
   it should be fixed by *adding* the scope, not by deleting `contest_id`.
2. **S1** — wire the submission filters that already exist. Smallest change, largest
   immediate win.
3. **E1 + V1 + V4** — lane persistence, batch re-eval, recoverable recompute. This is
   the evaluation/re-eval spine; everything else in §1 and §4 layers on it.
4. **R2 + R3** — a real freeze and a board changelog. These are what an operator
   actually reaches for during a live contest, and R2 discharges D1 properly.
5. **Then Option A** — introduce `communities`, scope `ranking_*` and overrides by it,
   and reshape the nav group. By this point the axis is already enforced in two places,
   so the migration is a rename with a backfill, not a redesign.

Option A last is deliberate: doing it first would mean migrating a ranking surface whose
scope is currently inconsistent, which is the worst possible moment to move it.

---

## 7. If you only do five things

1. **D2** — contest-scope the override fold (`overrides.rs:205` + panel `ranking.ts`).
   A `hide` currently leaks across every contest.
2. **D1** — implement or delete `freeze`. Right now it is a success toast that does nothing.
3. **S1** — expose `contestId` / `taskId` / `userId` on the submissions list. The backend
   already supports them; the page ignores them.
4. **V1 + V4** — batch re-evaluation on a two-phase, recoverable state machine.
5. **E1** — persist lanes instead of deriving them from a capped audit scan.

Items 1-3 are small. Items 4 and 5 are the spine for the rest of §1 and §4.
