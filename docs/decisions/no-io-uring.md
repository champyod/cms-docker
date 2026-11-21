# ADR: The Rust backend runs on Tokio; io_uring is not adopted

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Rust backend line
- **Scope:** the runtime of every Rust service in this stack (api/ops, ranking-web, workers)

## Context

io_uring removes the syscall enter/exit cost of asynchronous I/O and is the most significant I/O
change in the kernel in a decade, so "should the Rust backend use it" is a fair question asked
every time the stack is planned. It was answered here from live sources rather than from the
impression that newer is better.

## Decision

The backend stays on **Tokio with epoll**. io_uring is not adopted, and the reasons are not
taste:

1. **The runtime that would carry it is not maintained.** `crates.io` on 2026-10-25:
   `tokio-uring` 0.5.0, last release **2024-05-27**; `glommio` 0.9.0, **2024-03-25**;
   `monoio` 0.2.4, **2024-08-20**; the only live implementation is `compio` 0.20.0-**beta.1**
   (2026-09-29). Mainstream `tokio` is 1.54.1 (2026-10-21) — the ecosystem we already depend on
   (axum, hyper, sqlx/SeaORM, tracing) targets it and nothing else.
2. **It is a different runtime, not an optimisation flag.** `tokio-uring`'s README: *"Using
   `tokio-uring` requires starting a `tokio-uring` runtime. This runtime internally manages the
   main Tokio runtime and a `io-uring` driver."* Adopting it changes what every service boots on,
   and a bug there is a bug in the foundation of the API.
3. **Our containers deny it by default.** Docker's default seccomp profile is
   `defaultAction: SCMP_ACT_ERRNO`, and `io_uring_setup` appears nowhere in its 60 syscall rules,
   so io_uring is denied inside any container that does not run `seccomp=unconfined`. This compose
   file has exactly one such service — `worker` (`privileged: true`, seccomp and apparmor
   unconfined). That footing is defensible for a trusted batch worker and is not something to
   extend to a network-facing API.
4. **The workload has almost nothing for it to speed up.** The panel API is Postgres-bound over
   TCP behind nginx; the DB path is sockets on epoll. io_uring's win is local file I/O without
   syscall overhead — a path this service barely has.
5. **The host that matters cannot be checked.** This dev box (kernel 7.2.9,
   `kernel.io_uring_disabled = 0`) would run it; the production hosts cannot be read over SSH
   non-interactively, so "it works here" would not be evidence about the host that serves the
   contest.

## Consequences

- No new runtime dependency; `cargo-deny` surface unchanged.
- Container seccomp profiles stay at Docker's default for every network-facing service.
- The question is not re-litigated on vibes: it reopens **only** with a measured local-disk
  bottleneck (not a benchmark of io_uring itself), and even then the first step is a time-boxed
  `compio` spike on that one path, not a rewrite.
