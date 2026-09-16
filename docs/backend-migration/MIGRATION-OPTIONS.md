# Migration options

Six strategies, plus the option of not proceeding. Each carries its cost tier, effort, risk, blast
radius, what breaks, and how parity would be verified. **No option is selected here.** All tooling
named is free and open-source; every cost tier below is free unless stated otherwise.

## Summary

| Option | What moves | Cost tier | Effort | Risk | Blast radius | Upstream mergeability |
|---|---|---|---|---|---|---|
| OPT-0 | Nothing | Free | None | None | None | Preserved |
| OPT-1 | Panel backend only; no Rust | Free | Low | Low | Admin panel | Preserved |
| OPT-2 | Admin API in Rust; panel frontend-only | Free | Medium | Medium | Admin panel and admin API | Preserved |
| OPT-3 | Strangler: services replaced one at a time behind the preserved RPC protocol | Free | High, incremental | Medium, contained per step | One service per step | Partially forfeited, per service |
| OPT-4 | Full replacement, single cutover | Free | Very high | Very high | The whole system | Forfeited entirely |
| OPT-5 | Parallel-run hybrid with shadow comparison | Free | High | High | One service at a time | Partially forfeited |
| OPT-6 | Execute the confirmed single-backend plan; Rust deferred | Free | Medium | Medium | Panel and Python admin | Preserved until a later move |

## OPT-0 — Do not proceed

Keep the Python core and the current panel. **Cost tier:** free. **Effort:** none. **Risk:** none.

- What breaks: nothing.
- What is given up: the stated goals (a Rust backend, a frontend-only panel) are not met.
- Why it is on the list: replacing the core forfeits upstream mergeability permanently
  (`CONTEXT.md`). This is the correct choice if that cost outweighs the benefit.

## OPT-1 — Frontend-only panel without Rust

Move the panel's data access behind a small server-side layer that still runs on the current
stack, so the panel holds no backend logic, without introducing Rust.

- **Cost tier:** free. **Effort:** low. **Risk:** low. **Blast radius:** admin panel only.
- What changes: server components and server actions stop reaching Prisma directly; a thin backend
  interface owns data access and container control.
- What breaks: nothing external; the panel's internal structure changes.
- Limitation: this does not move any backend to Rust, so it satisfies only the panel goal.

## OPT-2 — Rust admin API, Python core untouched

Build the Rust API that the frontend-only panel calls; leave every Python service as-is.

- **Cost tier:** free. **Effort:** medium. **Risk:** medium. **Blast radius:** admin panel and the
  new API; the contest and ranking surfaces are untouched.
- What changes: the panel becomes a frontend-only TypeScript application with a single `api/`
  module; the Rust API owns data access (RLS-bound), permission enforcement, and container control.
- What breaks: the panel loses direct Prisma and Docker-socket access, so any behaviour that
  depended on them must be re-expressed through the API. The Docker socket must be moved behind the
  API with a superadmin check (REQ-S09).
- Participant impact: none.
- Verification: panel feature parity (REQ-F04) plus the security set.

## OPT-3 — Strangler, service at a time

Preserve the RPC wire format (REQ-F06) and replace one service per step, lowest risk first.

- Suggested order: checker, log, scoring, resource, proxy, worker, evaluation, then the web
  servers.
- **Cost tier:** free. **Effort:** high but incremental. **Risk:** medium; each step is small and
  reversible. **Blast radius:** one service per step.
- What breaks: nothing at once; each step is independently deployable and revertible because old
  and new components interoperate over the unchanged protocol.
- What is given up: upstream mergeability for each replaced service, as it is replaced.
- Participant impact: none until a web server is replaced; the contest and ranking servers are
  replaced last, so participant-visible risk is deferred and isolated.
- Verification: per step, run the replaced service against production-shaped data, then the full
  end-to-end rehearsal (REQ-F10) before touching a web server.

## OPT-4 — Full replacement, single cutover

Build the whole workspace and switch every component at once.

- **Cost tier:** free. **Effort:** very high. **Risk:** very high. **Blast radius:** the whole
  system, including the participant surface.
- What breaks: anything that drifted during the rewrite, discovered during the cutover.
- What is given up: upstream mergeability entirely and at once.
- Participant impact: direct and immediate; the highest-risk participant outcome of any option.
- Verification burden: the entire compatibility and security requirement set must be proven before
  the cutover, because there is no partial rollback.

## OPT-5 — Parallel-run hybrid with shadow comparison

Run a Rust component alongside its Python counterpart, feed both the same inputs, and compare
outputs before promoting the Rust one.

- **Cost tier:** free. **Effort:** high. **Risk:** high, because two systems run at once.
  **Blast radius:** one component at a time.
- What breaks: nothing if the Python component remains authoritative until promotion.
- Benefit: parity is observed rather than argued, which is the strongest answer to REQ-F10 and
  REQ-F11 and to the participant-fidelity concern.
- Cost: double the running infrastructure for the duration, and a comparison harness that must
  itself be trusted.

## OPT-6 — Execute the confirmed single-backend plan first

A user-confirmed plan already exists on this branch (`docs/PLAN-SINGLE-BACKEND.md`): the panel
becomes the only write backend and the Python admin becomes its API client, with security rules
generated from one TypeScript source. Recent branch history is already executing it.

- **Cost tier:** free. **Effort:** medium. **Risk:** medium. **Blast radius:** panel and Python admin.
- What it delivers: one write path, one permission source, and eventually one audit path.
- What it does not deliver: a Rust backend; the panel keeps backend logic.
- Relationship to the other options: OPT-6 composes with OPT-2 and OPT-3 as a preceding step —
  consolidate writes first, then move the consolidated layer to Rust (`ARCHITECTURE.md` section 8).
- What breaks: nothing external; the accepted risk is upstream merge conflicts in the handlers it
  rewrites.
- What it costs later: if the Rust task wins, the panel service layer it builds becomes throwaway.

## Process constraints that apply to every non-trivial option

- Section-by-section commits; in-progress sections may carry a work-in-progress prefix; no
  co-author trailer (REQ-P03), short imperative subjects (REQ-P04).
- Continuous integration gates formatting, linting, build, and tests on both stacks, plus the
  parity gates (REQ-P05).
- Generated API documentation from a free generator (REQ-P06).
- Clean-code and clean-comment rules on all new code (REQ-P01, REQ-P02).
- No paid dependency at any step (REQ-P07).

## Verification shared by all options

| Check | Applies to |
|---|---|
| Security requirement set passes (REQ-S01 to REQ-S16) | Every option that changes a service |
| Compatibility set passes, including the end-to-end rehearsal and operator sign-off (REQ-F01 to REQ-F11) | Every option that changes a user-facing surface |
| `audit_log`, `submissions`, role, and RLS invariants re-verified against the live database | Every option |
| The four repository parity gates still pass | Every option |
| No schema change, no migration | Every option |

## What every option costs

The irreducible, unrecoverable cost is the same in OPT-2 through OPT-5: **the alternative to a
Rust implementation is no longer a merge with upstream — it becomes a manual re-implementation of
every upstream fix.** `CONTEXT.md` states this in full. The option that avoids it is OPT-0.
