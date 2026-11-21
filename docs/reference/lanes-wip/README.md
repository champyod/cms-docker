# Lanes WIP — preserved verbatim

Source: `cms-lanes-worktree` (branch `feat/evaluation-lanes`, uncommitted working tree, 2026-10-05/06).
That branch is an **ancestor** of `major/admin-panel` (0 ahead, 633 behind), so none of this ever landed.

Ported verbatim under `docs/reference/lanes-wip/` — outside every build path — for one reason: the
files below do not compile against `major/admin-panel` at a093b003, and committing them in place
would turn `bun run build` red before the schema decision (design doc section 4, Q9) is settled.

## What is here

| File | Why it cannot go in as-is |
|---|---|
| `src/lib/worker-endpoints.ts` | Self-contained; reads `config/cms.toml` `Worker = [...]` then falls back to `.env`. Ports cleanly. |
| `src/app/actions/evaluationWorkers.ts` | Imports `prisma.evaluation_workers` — no such model in `major`. |
| `src/app/actions/evaluationLaneBoard.ts` | Same dependency on the lane/worker tables. |
| `src/components/submissions/LaneCard.tsx` | Depends on the lane board action shape. |
| `src/components/submissions/LaneWorkerAssignment.tsx` | Same. |
| `src/lib/evaluation-rpc.lanes-wip.ts` | The WIP version exports `callEvaluationRpc` / `unwrapRpcEnvelope`; `major`'s tracked `evaluation-rpc.ts` exports only `invalidateViaRpc`. Reconcile, do not overwrite. |
| `prisma-migrations/20260912000600_evaluation_lanes/migration.sql` | Targets the old schema; must be re-derived, not replayed. |
| `tracked-mods.patch` | 1920-line diff of the 13 tracked files the old branch modified. Cannot be `git apply`-ed across 633 commits. Evidence of intent only. |

## Verified during the port

- `workers_status` **does exist** in the current tree: `src/cms/service/EvaluationService.py:439`, authorized at `src/cms/server/admin/rpc_authorization.py:31`. The WIP's RPC call is valid.
- `evaluation_workers` does **not** exist in `admin-panel/prisma/schema.prisma` (verified: zero `lanes` / `worker_id` / `evaluation_workers` matches).

## Consume it this way

Read `worker-endpoints.ts` as the design for config discovery, and `evaluationWorkers.ts` as the
design for a refresh-on-read registry (upsert, never delete; mark `enabled = false` when a worker
leaves the config). Re-derive both against the schema agreed in design doc section 4.
