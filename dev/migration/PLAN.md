# System migration to Rust — the plan and the slices

Everything the Python CMS does, re-expressed as crates in the `backend` workspace, except the
frontend (`admin-panel`, Next.js/TypeScript), which keeps its own session and is untouched here.

Strategy: **OPT-3, the strangler** (`MIGRATION-OPTIONS.md:OPT-3`). One service at a time, each made
to speak the RPC protocol that is already preserved, so a step can land and be verified without the
rest of the system having moved. `OPT-4` (single cutover) is rejected because a failure in it cannot
be attributed to one component; `OPT-5` (shadow run) stays available per slice as the verification
method — it is a way to check a step, not a different way to move.

Status of this document: the slice order and sizes below are **measured**, on
`feat/rust-trunk-reconcile` at `937c06e3`. The deliverable of each slice is a done-condition, not a
prose goal; a slice that cannot state its check is not in the list.

---

## 1. What is already Rust, and what is not

| Component | Now | Files / lines | Ships from |
|---|---|---|---|
| `backend` (5 crates) | **Rust** | 151 / 21,343 | `Dockerfile`, `cms-docker-core` |
| `ranking-web` | **Rust** | 62 / 11,729 | `Dockerfile:201` → `cms-ranking` |
| `tools/cms-tui` | **Rust** | 100 / 14,722 | `.tools/cms-tui/cms-tui-linux-x86_64` |
| `tools/sec-digest` | **Rust** | 50 / 5,953 | CI |
| `src/cms/server` | Python | 59 / 13,341 | `cms-contest-web-server` |
| `src/cms/grading` | Python | 43 / 8,452 | in-process |
| `src/cms/db` | Python | 21 / 6,816 | in-process |
| `src/cms/service` | Python | 13 / 4,628 | 7 containers |
| `src/cmscommon` + `cms/conf,io,log,locale,util` | Python | 23 / 4,913 | in-process |
| `src/cmscontrib` | Python | 81 / 11,057 | 81 CLI tools |
| `src/cmsranking` | Python | 13 / 2,441 | **nothing — already superseded by `ranking-web`** |
| `src/cmstaskenv` | Python | 3 / 1,093 | worker containers |
| `src/cmstestsuite` | Python | 144 / 22,786 | test harness |
| `src/setup.py` + `src/install.py` + `src/docs/*.py` | Python | 4 / 736 | packaging |

Covered by the goal's six areas: **405 files, 76,707 lines**. Adding the 4 root files the goal also
names as part of `src/`: **409 files, 77,443 lines** — which is every `.py` under `src/`, nothing
left over.

### 1.1 The two corrections that change the work

- **`src/cmsranking` is dead code.** `Dockerfile:201` copies the Rust `cms-ranking` binary in; no
  compose service runs the Python module; the only remaining importers are
  `src/cmstestsuite/unit_tests/ranking_credits_test.py:35` and `src/cmstestsuite/coverage.py:39`.
  Its slice is a deletion plus a test port, not a 2,441-line rewrite.
- **`backend` already owns the RPC transport.** `cms-proto/src/codec.rs:3` names
  `src/cms/io/rpc.py` as the contract it re-expresses, and `cms-svc/src/lib.rs:3` names
  `RemoteServiceClient._run`. So slice 0 is *finish and prove*, not *start*.

---

## 2. The dependency graph, as measured

Import edges across areas, from an AST-free scan of every `from cms… import` in `src/`:

```
cms.server      -> cms.db          70
cmstestsuite    -> cms.{grading,db,server}   81
cms.service     -> cms.db          14   and  -> cms.io  12
cms.grading     -> cms{,.db}       20
cms.db          -> cms{,.grading,.io}  11
cmscontrib      -> cms.db          49   and  -> cms.grading/comon  12
cms.io          -> cms{,.db,.server}   8
```

**The ten modules `cms.{conf,db,grading,io,locale,log,server,service,util}` + `cmscommon` form one
cycle** (Tarjan SCC of the area graph: one component of 10). That is the honest shape: this is a
monolith with a service mesh on top, not a layered stack. Consequences that the slice order must
respect:

1. A **bottom-up order does not exist** for the core. Any "db first" claim is false — `cms.db`
   imports `cms.grading`, `cms.io` and `cms.conf`, and they import it back.
2. The cycle is **broken at the leaves**, not at the root: `cmscommon.*` and `cms.io/rpc.py` are
   imported by everything and import little that is circular. That is why slice 0 targets them.
3. Each later slice therefore **seams on the RPC protocol** (already-implemented in `cms-proto`),
   not on a module boundary. A container that speaks the protocol can be swapped in isolation; a
   Python module cannot.

---

## 3. Slices

Ordered by (a) how many other slices are blocked on it, (b) whether it can be verified alone.
`Blocked by` is a hard edge; anything not listed is independent and can run in a separate lane.

Every line count in the table below is the sum of that slice's source paths, measured with
`find <path> -name '*.py' -exec cat {} + | wc -l`; `src/cms/conf.py`, `log.py` and `util.py` are
single files, not directories. Three rows aggregate and say so in their name, so they read higher
than any one `ls` would suggest:

- **S-2** = `cmscommon` 1,922 + `conf.py` 285 + `log.py` 408 + `util.py` 344 + `locale/` 428 +
  `io/` 2,563 = **5,950**. It is the largest slice outside `cmscontrib` and `cmstestsuite`, and it is
  mostly transport.
- **S-9** is the whole `src/cms/server` tree (13,338) and therefore **contains S-7 and S-8**. Its own
  remainder is 13,338 − 5,651 − 5,376 = **2,311**, which is what it contributes to the total.
- **`src/cms` root also holds `__init__.py` (81) and `plugin.py` (65)** = 146 lines that belong to
  no slice. They are named here rather than left in a difference.

The slices reconcile to the goal's number exactly, computed not estimated:

| | lines |
|---|---|
| sum of slice contributions (S-9 as 2,311) | 76,561 |
| `cms/__init__.py` + `cms/plugin.py`, unassigned | 146 |
| `setup.py` + `install.py` + `docs/` | 736 |
| **every `.py` under `src/`** | **77,443** |

and without the packaging root, the same sum is the 76,707 the six goal areas contain. There is no
residual: 76,561 + 146 + 736 = 77,443, checked against `find src -name '*.py' -exec cat {} + | wc -l`.

| # | Slice | Lines | Blocked by | Done when |
|---|---|---|---|---|
| S-0 | **Reconciliation** (this lane) | — | — | All four gates exit 0 on one tree; the merge is accounted for. **Done at `937c06e3`.** |
| S-1 | **Equivalence harness + render parity** | — | S-0 | A Rust test that starts both stacks against one seeded DB and diffs every HTTP response body and status on the contest + admin surfaces. Exits 0 with a recorded diff of 0, and **fails on a planted one-line behaviour change** (negative control). **Done at `58a6c24b`, branch `feat/rust-S1-equivalence-oracle`: 17 requests over 12 surfaces, 20 unit tests, and falsified both ways by the parent's own run — planted change → exit 1 / `diff=1`; restored → exit 0 / `diff=0`.** |
| S-2 | **`cmscommon` + `cms.io` transport** (+ `conf`, `log`, `util`, `locale`) | 5,950 | S-0 | `cms-proto` covers every `<type>; value` / `@`-annotation and framing case in `src/cmscommon/*.py`, with the Python file deleted per module only when its Rust port's tests pass. Gate: `cargo test -p cms-proto`. **Split three ways, by what actually blocks what: S-2c `datetime` (110) ran FIRST because `cms/db` imports it — done at `2e28ff39`, `feat/rust-S2c-datetime`; S-2a `crypto`+`binary`+`digest` (449) is done pending B1; S-2b `archive`+`conf_parser`+`mimetypes`+`terminal` (739) runs last, because every one of its Python modules still has live Python consumers (`conf_parser` ← `cms/conf.py`, `terminal` ← `cms/log.py` + `cmstaskenv`, `mimetypes` ← 5 files, `archive` ← 3 files) so its "delete the Python file" criterion is only satisfiable by deleting code still in use. `eventsource` (400) leaves the slice entirely — see F1.** |
| S-3 | **`cms.db`** | 6,816 | S-2 | Every query in `src/cms/db/*.py` (21 modules) has a Rust equivalent against the same schema, verified by S-1's harness returning 0 diffs on the admin + contest read paths while the Python service is stopped. |
| S-4 | **Ranking reconciliation** (delete) | 2,441 | S-2 | `src/cmsranking` deleted; `ranking_credits_test.py` ported to `ranking-web/tests`; `Dockerfile:201` unchanged and `bun`/`cargo` gates green. **Done at `b15ebf92`, branch `feat/rust-S4-retire-cmsranking`: 6 of 13 assertions already covered in Rust, 6 ported and falsified, 1 dropped as a genuine duplicate. Verified by absence (0 `cmsranking` refs in `src/`, 0 syntax errors, Dockerfile untouched with 0 mentions) and catches a real licence bug the port fixed: the Rust ranking served one compiled-in AGPL offer URL, so a fork could not point it at its own repository, which `cmsranking/Config.py:41-51` existed to allow.** |
| S-5 | **`cms.grading`** (43 files, 8,452) | 8,452 | S-3 | `Job.py`, `Sandbox.py`, `languagemanager.py`, `scoretypes/`, `tasktypes/` each ported with its `unit_tests/` counterpart green; the worker executes one real submission end to end through the Rust path. |
| S-6 | **`cms.service`** (7 services, 27 RPC methods) | 4,628 | S-2, S-3 | Each of `LogService`, `ResourceService`, `ScoringService`, `EvaluationService`, `ProxyService`, `Checker`, `Worker` replaced one at a time; for each, S-1 exits 0 with that container swapped and the Python one stopped. 27 methods = 27 checked handovers. |
| S-7 | **Contest web server** (`cms.server/contest`, 24 files) | 5,651 | S-1, S-3, S-5 | `cms-contest-web-server` runs the Rust binary; S-1 diff 0 on the whole participant surface; a functional test round-trips submit → score → ranking. |
| S-8 | **Admin web server** (`cms.server/admin`, 22 files) | 5,376 | S-3 | `cms-admin-web-server` runs the Rust binary; the panel's server-side calls pass against it unchanged (the panel is not edited — that is the parity proof). |
| S-9 | **`cms.server` top-level** (captcha, login lockout, middleware, credits) | 2,311 of 13,338 | S-7, S-8 | The security-bearing modules land before the servers that use them; `login_lockout_ledger`, `login_exemption`, `login_refusal`, `captcha*` each carry their own test plus a negative control. |
| S-10 | **`cmscontrib`** (81 CLI tools) | 11,057 | S-3, S-5 | 81 commands. Gate is a table, not a claim: every command in `ls src/cmscontrib/*.py` has a `cms-tui` subcommand or a `tools/` binary, and the table is checked by a script. |
| S-11 | **`cmstaskenv`** | 1,093 | S-5 | Task container entrypoint is Rust; a real task builds and grades. |
| S-12 | **Test harness** (`cmstestsuite`) | 22,786 | S-1…S-11 | The 382-file admin suite and the Python functional suite both run against the Rust system; `coverage.py:39` no longer names `cmsranking`. |
| S-13 | **Packaging** (`setup.py`, `install.py`, `Dockerfile`) | 736 | S-12 | No `python` in any image; `src/` deleted; `make` targets still work. |
| S-14 | **Deletion of `src/`** | — | S-13 | `git rm -r src`; whole-tree gate green; no Python process in `docker compose ps`. |

Two orderings that are **not** negotiable, and why:

- **S-1 before S-5 through S-12.** The harness is the oracle for every later slice. Landing a slice
  before its oracle exists means the "it still works" claim is a self-report.
- **S-9 before S-7/S-8 land in production.** The lockout, exemption and captcha modules are what
  `THREAT-MODEL.md` rests on; porting the server first and the guards after would ship a window
  with no lockout.

---

## 4. Per-slice brief template

Every dispatch carries exactly this and points at the documents instead of restating them:

```
Slice S-N: <one sentence>
Lane:       .worktrees/rust-S-N, cut from feat/backend-rust
May touch:  <exact paths>
Must not:   admin-panel/**, docs/DESIGN*.md, any other lane
Done when:  <the check from §3, verbatim>
Authority:  Tier A inside the slice; Tier C for a new dependency or a schema change
Read:       dev/agent-protocol.md §1 (binding), dev/migration/INVENTORY.md §<n>
            (the behaviour to reproduce), THREAT-MODEL.md §<n> (what must not weaken)
```

---

## 5. Open, and blocking

| # | What | Blocks |
|---|---|---|
| Q1 | Does `backend` become one crate or stay five, as slices land? | S-3 onwards — it decides which crate owns a function, and moving later is a rewrite |
| Q2 | Is the DB schema frozen for the migration? `OPEN-QUESTIONS.md` OQ-05/OQ-06 say two RLS exemptions are unconfirmed | S-3, S-8 |
| Q3 | Is the contest surface allowed to change at all, or is byte-parity required? | S-7 — decides whether S-1 diffs bodies or only status+shape |
| Q4 | Which of `src/cms/server/admin` and the panel's Python `cmsAdminWebServer` is the surviving admin surface? | S-8 |
| Q5 | Upstream mergeability: `CONTEXT.md` says a core replacement forfeits it permanently. Confirmed? | everything — this is the cost the goal accepts |

Q5 is the one that can still cancel the plan, and `MIGRATION-OPTIONS.md:OPT-4` already flags it.
It is recorded here rather than assumed.

## 6. Blockers and findings, kept current

| # | What | State |
|---|---|---|
| B1 | **Two crates for S-2a**: `aes` 0.8 and `bcrypt` 0.17 (verified: 0 occurrences in `Cargo.lock` at `e418a316`; `base64`/`sha1`/`rand` already transitive). Proposed in `0b76f9f2` on `feat/rust-S2a-crypto-core`, one revert. Asked twice 2026-11-22, both forms timed out unanswered. | **OPEN — operator.** No crate that depends on `cms-db` can be called green on the trunk until it is answered. |
| F1 | **`src/cmscommon/eventsource.py` (400 lines) does not need porting.** Its only Python consumer is `src/cmsranking/RankingWebServer.py:47` — the module S-4 deletes — and the Rust equivalent already exists: `ranking-web/src/events.rs` (accepts `text/event-stream`, the ten-minute close, the media-range matching). It leaves S-2 along with S-4, so S-2 drops 5,950 → 5,550 and S-2b is 739 lines, not 1,139. | Recorded; S-4's deletion is the trigger, so no extra step. |
| F2 | **A pre-existing auth gap the port must carry.** `cms-db/src/auth.rs`'s `PlaintextPassword::matches` authenticates a `plaintext:` row, while `src/cmscommon/crypto.py:213` deliberately refuses one — its own comment: a `plaintext:` row *is* the password, so honouring it hands the account to anyone who can read the database. Nothing calls `matches` on a login path yet, so it is not exploitable today. | **Must land before S-8** (the admin web server). Not S-2a's, which ported the functions faithfully. |
| F3 | **The `cmscommon` cipher is AES-128-CBC with no MAC and an unvalidated padding**, and existing ciphertext lives in the database and `config.toml`. Replacing it is a migration with a dual-read re-encryption path, not a refactor. | **Operator's call, not taken.** Reported by S-2a; the port is byte-compatible instead. |
| F4 | **CI `icons:check` will go red because S-4 deleted the tree it still references.** `admin-panel/scripts/generate-icons.mts:128-130` lists `src/cmsranking/static/img/favicon.ico`, `…/logo.png`, `src/cmsranking/images/logo.svg`; `.github/workflows/ci.yml:523` runs `bun run icons:check` unconditionally and a missing input reads as drift. | **OPEN — the frontend session's files.** Three array entries to delete; not editable from a backend lane. |
| F5 | **A licence bug the port found and fixed.** The Rust ranking served one compiled-in AGPL section-13 offer URL, while `cmsranking/Config.py:41-51` read `source_url` from `cms_ranking.toml` precisely so a fork could point the offer at its own repository. `/config` now takes the URL from the file `/credits` serves, falling back to the constant only when no file can supply it (`b32ffdad`). | Landed with S-4. |
| F6 | **A verification lesson worth keeping.** A negative control is evidence only about the tests its command runs: breaking the licence fallback and running `cargo test --test surface` showed 33 passing and looked like an untested branch, but the guard lives in the **lib** unit tests, which that command never runs. Run the scope that owns the code under test. | Recorded after a false positive on S-4. |

## 7. Landing log

Lanes are merged into `feat/rust-trunk-reconcile` only after the parent re-runs their gate; the merge
commit names the lane tip and the gate result it was accepted on.

| When | Lane | Tip | Gate re-run by the parent | Merge commit |
|---|---|---|---|---|
| 2026-11-22 | `feat/rust-S2c-datetime` | `2e28ff39` | `cargo test -p cms-db --test mapping_datetime` → 7 passed, 0 failed, 2 ignored | `a3a605c4` |
| 2026-11-22 | `feat/rust-S1-equivalence-oracle` | `58a6c24b` | `python3 -m unittest tests/test_render_parity.py` → 20 tests OK | `b282ed4c` |
| 2026-11-22 | `feat/rust-svc-host` | `32db4b41` | `cargo test -p cms-svc` → 25 passed; parent's own mutation of `connection.rs:76` (`Send::Dropped` → `Flow::Continue`) failed `refusals::a_request_without_an_id_closes_the_connection_without_a_reply`, exit 101, then restored byte-identical | `578c743d` |
| 2026-11-22 | `feat/rust-logservice` | `e9158035` | `cargo test -p cms-svc` → 42 passed; parent's own mutation of `recent.rs:12` (`CAPACITY` 100 → 99) failed `log::sink::tests::a_hundred_and_one_warnings_keep_the_newest_hundred_in_order` with left 99 / right 100, exit 101, then restored byte-identical | `57f5be26` |
| 2026-11-22 | `feat/rust-logsvc-bin` | `cd5b6a13` | `cargo test -p cms-svc` → 45 passed; `bash scripts/__test_config_sync.sh` → 24 passed; parent's own mutation (fail-open `required()`) failed the two startup tests in 5.02s, exit 101, restored byte-identical after the parent bounded `run_with` with a watchdog | `4d7a8bad` |
| 2026-11-22 | `feat/rust-svc-surface` | `cc92e0ff` | `cargo test -p cms-svc` → 57 passed; parent's own mutation of `inflight.rs` (condvar loop removed) failed **no** test, so the parent added the missing in-crate assertion; the same mutation now fails at 4.141µs, exit 101 | `9bf7953c` |

Gate on the tree after all six merges (`9bf7953c`): `cargo fmt --check` exit 0; `cargo clippy
--all-targets -- -D warnings` exit 0; `cargo test -- --test-threads=1` → 68 test binaries, 372 passed,
0 failed, 2 ignored, exit 0; `bash scripts/__test_config_sync.sh` → 24 passed, exit 0; `bash
scripts/__check_agent_protocol.sh` → exit 0. Serial because the parallel run hits the pre-existing
`ETXTBSY` race on `backend/target/tmp/**/isolate` (`sandbox_launch.rs:79`, `sandbox_drain.rs:57`) —
recorded, not fixed. Three consecutive parallel whole-tree runs before this merge were green
(360 passed each), so the race did not reproduce in that window.

**Divergence carried by LogService — MEASURED AND WITHDRAWN (2026-11-22).** This entry first claimed the
Rust formatter printing UTC was a behaviour change from Python's `time.localtime`, and warned that a
non-UTC host would log a different clock. Production says otherwise, so the warning was wrong:

- `ssh com-o@<prod> docker exec cms-log-service date` → `Sun Nov 22 06:42:08 UTC 2026`. The log
  container runs in UTC: nothing in `docker-compose*.yml` or the `Dockerfile` sets `TZ`, and the base
  image carries no zone configuration, so `time.localtime` is UTC there.
- The container's own current log, `/var/local/log/cms/cms/1795328852.log` line 1:
  `2026-11-22 06:27:32,291 - INFO [Log,0 Main service::run] LogService 0 up and running!` — the printed
  clock is UTC and agrees with the file's mtime, which is what the symlink listing reports.

So `FormatterSettings::UTC` reproduces the production behaviour it replaces, and no operator action is
needed. What remains true is narrower: the offset is a constructor argument with no caller that passes
one, so a deployment that ever moved a log container off UTC would drift silently. Recorded as a
limitation of the setting, not as an active divergence.


A lane is removed as soon as it is merged and its gate is green — worktree deleted, branch deleted,
`git worktree prune`. A merged lane left on disk is 1-11 GB of build artifacts holding a branch label
nothing needs, and it makes the next sweep unable to tell stale work from live work.

### 7.3 `psutil` replacement — decided: `procfs` (2026-11-22)

`ResourceService` is the one service that needs neither `cms.db` nor `cms.grading`, so it is the natural
second swap after the logger — except it samples processes through `psutil`, which has no std
equivalent. Measured surface, from `grep 'psutil\.' src/`: `virtual_memory`, `swap_memory`, `cpu_times`,
`cpu_count`, `process_iter`, and per process `cmdline`, `cpu_times`, `as_dict`, `is_running`,
`NoSuchProcess`. All of it is `/proc` on Linux.

Three candidates, from crates.io metadata rather than memory:

| | License | MSRV | Normal dependencies | Latest |
|---|---|---|---|---|
| **A. direct `/proc` with `std`** | ours | — | **none** | — |
| `procfs` 0.18.0 | MIT OR Apache-2.0 | 1.70 | `bitflags`, `procfs-core`, `rustix` | 2025-08-30 |
| `sysinfo` 0.40.4 | MIT | 1.95 | `libc`, plus optional per-platform crates | 2026-11-16 |

Toolchain satisfies both crates (`rustc 1.99.1` locally, `rust:1-bookworm` in the image), so MSRV did
not decide it. **Operator first chose A** (zero dependencies), then revised to **`sysinfo`**, on the reasoning that
"no dependency" is not the same as "more secure" — it trades a supply-chain risk for a parser we own on
attacker-influenced input (`any` process sets its own `comm` and `argv`). That reasoning was accepted.

**`sysinfo` was then measured and does not fit.** Its 0.40 API cannot produce three values the service
returns: `Cpu` exposes only `usage`, not the per-key cumulative times `ResourceService.py:325-328`
differences into `data["cpu"]`; `System` has total/available/free/used memory and swap but **no `cached`
and no `buffers`**, which `:341-345` reports; and per process it offers `accumulated_cpu_time()` only,
where `:83` stores psutil's separate user and system figures.

**Chosen: `procfs` 0.18.0** — Linux-only, which is exactly the deployment (Debian packaging under
`src/debian/`, three systemd units under `src/config/systemd/`, `ubuntu:noble` base image, and no
`darwin`/`macos`/`windows` reference anywhere in the tree). Its `CpuTime` carries all ten fields psutil
reports, `Meminfo` carries `buffers` and `cached`, and `/proc/[pid]/stat` gives the per-process split.
Cost: `bitflags`, `procfs-core`, `rustix`.

**Rejected: `sysinfo`** — measured above; it cannot produce three of the values the service returns.

**Rejected: direct `/proc` with `std`** — the operator raised it, then withdrew it for a better reason
than "fewer crates": *no dependency* is not the same as *more secure*, it trades a supply-chain risk for
a parser we own. And `/proc` is attacker-influenced input — any process sets its own `comm` (via
`prctl`, 15 characters) and its whole `argv`. The hazard that makes this concrete:
`/proc/[pid]/stat` field 2 is wrapped in parentheses and may itself contain **spaces and a `)`**, so the
only correct split is at the **last** `)`. `procfs` exists to get that right. Severity was checked
before it was used as an argument: `kill_service` does **not** kill by pid — it sends `quit` over RPC
(`ResourceService.py:441`) — so a mis-parse could not kill the wrong process; the realistic worst case
is a panic, i.e. a crashed resource monitor.

Unit note carried into the port: cpu times are clock ticks and converting them normally needs
`sysconf(_SC_CLK_TCK)`; the kernel's userspace ABI fixes USER_HZ at 100, and the service derives
percentages from **deltas** between two samples, where the constant cancels — but `resident` is reported
absolutely and must be converted to bytes.

### 7.1 First service swap completed — the logger (2026-11-22)

`log-service` in `docker-compose.yml` now runs `cms-log-service`. This is the first W-B swap and the
template every later one follows. Commits, in order: `4baaca29` (image ships the binary),
`466b0eb3` (the container runs it).

What the swap actually required, none of it optional:

| Change | Why it is not separable |
|---|---|
| `Dockerfile` gains a `backend-build` stage | the image had no backend stage at all, only `ranking-build`, so no Rust service could ship |
| `.dockerignore` gains `target/` and `**/target/` | without it the new stage copies every worktree's build artifacts into the build context before compiling |
| `environment` gains `LOG_SERVICE_ADDR`, `LOG_DIR`, `RPC_SECRET` | no service in this compose file uses `env_file`, so values `config sync` renders are substitution-only and never reach a container; the binary would exit naming whichever it lacks |
| `command` loses the shard argument | the Rust binary reads its address from the environment; a positional shard would be silently ignored. The shard still selects the log directory via `LOG_DIR` |
| `healthcheck` pattern `cmsLogService` → `cms-log-service` | the old pattern cannot match the new process name, so the container would sit unhealthy and restart-loop while serving correctly |

Verified here: `docker compose config` exit 0; `docker build --target backend-build` exit 0 in 7.2s with
the 821,640-byte binary inside it, and running that binary with no environment exits 1 saying
`LOG_SERVICE_ADDR is unset or empty`; `bash tests/test_image_pins.sh` exit 0.

**Not verified here, and not mine to do: the deploy.** Restarting `cms-log-service` is a production
action; this work only makes the next deploy run the Rust service. The rollback is one line — put
`cmsLogService ${LOG_SERVICE_SHARD:-0}` back in `command` and the old `pgrep` pattern in
`healthcheck`.

### 7.2 Service order, corrected against the imports (2026-11-22)

The order first proposed was LogService, ScoringService, ResourceService, ProxyService, Worker,
EvaluationService — smallest file first. The imports say otherwise, and file size is the wrong
measure. Measured with `grep -E '^from cms' src/cms/service/*.py`:

| Service | Needs `cms.db` | Needs `cms.grading` | Needs the log stack | External Python modules |
|---|---|---|---|---|
| `LogService` (122) | no | no | **yes** (`cms.log`) | none |
| `ResourceService` (481) | no | no | no | **`psutil`** |
| `ScoringService` (235) | **yes** | no | no | none |
| `ProxyService` (780) | **yes** | no | no | none |
| `Worker` (197) | **yes** | **yes** | no | none |
| `EvaluationService` (1178) | **yes** | **yes** | no | none |

Only LogService and ResourceService are free of `cms.db`, and `cms.db` is S-3, which B1 blocks. Between
those two, `ResourceService` samples processes through **`psutil`** (`ResourceService.py:88-118`,
`_get_all_processes`, `_get_interesting_running_processes`) and has no std equivalent — a replacement
crate is a new dependency, which is a Tier C question. LogService reaches instead for `cms/log.py`,
whose formatter is string formatting over a mutable record and portables with `std` alone.

**Chosen: LogService first**, and the epic carries the log layer it needs rather than waiting for S-2b.
**Rejected: ResourceService first** — it is the better seam but it needs `psutil`'s replacement decided
first. **Rejected: keep the file-size order** — it would have started the largest service before the
machinery had been exercised once.



Not merged, and why: `feat/rust-S2a-crypto-core` (`1fd7f8cc`) is blocked on **B1** (the `aes`/`bcrypt`
dependency decision). `feat/rust-S4-retire-cmsranking` (`b15ebf92`) deletes `src/cmsranking`, which is
tangled with the open question of whether `src/` becomes an upstream submodule — deferred rather than
merged, because the answer decides whether that deletion is meaningful or moot.

`scripts/__check_render_parity.sh` is **not** wired into `scripts/__gates.sh` (checked: `__gates.sh:17-23`
lists six `__check_*` scripts and not this one). It boots two Docker stacks, so wiring it is a cost
decision, not an oversight to fix quietly.
