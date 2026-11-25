# S-6d3l runner claim

S-6d3j owns `backend/cms-db/src/writes/**`, `backend/cms-db/tests/**` and
`coordination/BOARD.md`; this slice touches none of them.

- Lane: `.worktrees/rust-S6d3l-runner`
- Branch: `feat/rust-S6d3l-runner`, base `feat/rust-trunk-reconcile` @ `981a6d6e`
- Owner: hermes-agent
- Files: `backend/cms-evaluation/src/{lib.rs,runner.rs}`,
  `backend/cms-evaluation/tests/runner/**`, `coordination/chat/S6d3l-runner.md`
- Scope: one pure orchestration function: build one submission job body, dispatch
  it to one worker shard, parse every returned body into `WorkerOutput`. It does
  not load from the database, commit results, retry, or start a service loop.
