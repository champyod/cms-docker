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
| S-1 | **Equivalence harness + render parity** | — | S-0 | A Rust test that starts both stacks against one seeded DB and diffs every HTTP response body and status on the contest + admin surfaces. Exits 0 with a recorded diff of 0, and **fails on a planted one-line behaviour change** (negative control). |
| S-2 | **`cmscommon` + `cms.io` transport** (+ `conf`, `log`, `util`, `locale`) | 5,950 | S-0 | `cms-proto` covers every `<type>; value` / `@`-annotation and framing case in `src/cmscommon/*.py`, with the Python file deleted per module only when its Rust port's tests pass. Gate: `cargo test -p cms-proto`. |
| S-3 | **`cms.db`** | 6,816 | S-2 | Every query in `src/cms/db/*.py` (21 modules) has a Rust equivalent against the same schema, verified by S-1's harness returning 0 diffs on the admin + contest read paths while the Python service is stopped. |
| S-4 | **Ranking reconciliation** (delete) | 2,441 | S-2 | `src/cmsranking` deleted; `ranking_credits_test.py` ported to `ranking-web/tests`; `Dockerfile:201` unchanged and `bun`/`cargo` gates green. |
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
Read:       docs/agent-protocol.md §1 (binding), docs/backend-migration/INVENTORY.md §<n>
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
