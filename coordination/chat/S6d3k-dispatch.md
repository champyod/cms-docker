# S-6d3k worker dispatch claim

S-6d3j holds `coordination/BOARD.md` and `backend/cms-db/tests/**`. This slice
does not touch either.

- Lane: `.worktrees/rust-S6d3k-dispatch`
- Branch: `feat/rust-S6d3k-dispatch`, base `feat/rust-trunk-reconcile` @ `f01481ac`
- Owner: hermes-agent
- Files: `backend/cms-evaluation/src/{lib.rs,dispatch.rs}`,
  `backend/cms-evaluation/tests/dispatch/**`, `coordination/chat/S6d3k-dispatch.md`
- Scope: one persistent `cms-svc::Client` per worker shard, send one
  `execute_job_group` request, validate the returned job count, drop the client on
  transport failure so the next call reconnects. No retry, no database, no writes,
  no result handling.
- Status: done — lane `69d8a79d`, merged `c35fefe7`; lane 67 passed, merged
  **181 targets / 1200 passed / 0 failed / 2 ignored**; count control red then
  byte-restored. Files released.
- Non-overlap: no `backend/cms-db/**`, no `coordination/BOARD.md`, no S-6d3j files.
