# Framework evaluation: should the frontend and backend be split, and would a faster framework help?

This repository contains no performance measurement of any kind — no benchmark, no profile, no query log, no timing data — so there is currently no evidence that a faster framework would help, and none that the language is the bottleneck. The dominant cost of replacing the Python core is not engineering effort: the core is vendored upstream code with no recorded upstream pin, and a rewrite permanently forfeits the ability to merge upstream fixes. The recommendation is to measure first, then address the real, documented problem (the pinned, unsupported Tornado and SQLAlchemy versions); a language migration is unjustified until the measurements listed in section 8 exist.

## 1. The question, and what would have to be true

The question asks whether the frontend and backend should be split into different languages, and whether a faster framework would help. Two distinct claims are hidden inside it, and they are routinely conflated:

- **"The frontend and backend should be in different languages"** is an architecture claim. It is judged by looking at where the boundary already is and what a new boundary would cost.
- **"A faster framework would help"** is a performance claim. It requires evidence that a bottleneck exists, that the bottleneck is in the framework or the language, and that the affected path matters. None of that evidence exists in this repository.

The first claim is largely already true today (see section 6). The second claim is entirely unmeasured (see section 4).

## 2. The fork constraint (the biggest cost)

Any option that rewrites Python code must first survive this section.

- The Python core under `src/cms/`, `src/cmscommon/`, `src/cmsranking/` and `src/cmscontrib/` is vendored from an upstream project. Vendoring means plain copied files, not a git submodule — there is no `.gitmodules` and no nested repository, so the vendored tree carries none of its own history.
- There is no recorded upstream pin. The checkout cannot be diffed against upstream; `docs/FORK-SUMMARY.md` documents a best-guess base revision (`b98e44b5`, post-v1.5.1, early 2026) and names two sync commits, but this is documentation, not a verifiable reference. The fork summary itself flags the missing pin as a known risk.
- The fork summary reports roughly 325 fork-era commits against roughly 4,640 upstream-era commits — about 6.5 percent of the history is fork-authored. These figures come from the repository's own documentation and have not been independently verified.
- Replacing the Python core forfeits the ability to merge upstream fixes. Upstream is an active project with a decade of accumulated correctness and security fixes behind it; a rewritten core severs that supply line permanently. Any option in section 7 that rewrites core code must be justified against this loss, not merely against its own build cost.
- One contradiction in the repository's own documentation must be reconciled before any rewrite is scoped. `docs/FORK-SUMMARY.md` states that only three areas of Python were touched (the evaluation queue fairness change, admin permissions, ranking logo/branding). But the same document's permission-rebuild section describes substantially more local work: SQLAlchemy models for the new permission and audit tables, group-based permission checks, all admin handlers re-decorated, roughly twenty templates migrated, and the five legacy boolean permission columns dropped. The code for the permission rebuild is present in this checkout (for example `src/cms/db/permissions.py`, plus the group-aware checks throughout `src/cms/server/admin/`). The honest conclusion: treat the local divergence surface as larger than the three-area summary claims, and treat every "this file is byte-identical to upstream" statement as unverified until a real diff exists (see section 8, item 7).

## 3. What the system actually is

The backend is a set of cooperating Python services plus two non-Python paths (section 6). All entries below are the in-tree entry points.

| Service | Entry point | What it does | Talks to |
|---|---|---|---|
| Grading worker | `src/scripts/cmsWorker` | Runs the isolate sandbox; executes compilation and evaluation jobs | Evaluation service over RPC; log service |
| Evaluation service | `src/scripts/cmsEvaluationService` | Owns the submission queue and dispatches operations to workers | Workers over RPC; database; log service |
| Contest web server | `src/scripts/cmsContestWebServer` | Contestant UI; server-rendered HTML in the same process that answers the request | Database; log service; contestants over HTTP |
| Admin web server | `src/scripts/cmsAdminWebServer` | Legacy Python admin UI | Database; log service |
| Ranking web server | `src/scripts/cmsRankingWebServer` | Live scoreboard served from its own in-memory store; no database on its read path | Proxy service over HTTP (writes); spectators over HTTP and server-sent events |
| Log service | `src/scripts/cmsLogService` | Central log sink on the write path of every service | All services over RPC |
| Resource service | `src/scripts/cmsResourceService` | Process supervisor | Supervised services; log service |
| Scoring service | `src/scripts/cmsScoringService` | Computes and finalizes scores | Database; log service |
| Proxy service | `src/scripts/cmsProxyService` | Pushes scores to the ranking servers | Database; ranking web server over HTTP |
| Checker | `src/scripts/cmsChecker` | Heartbeat: echo round-trip probe against every service; not a task comparator | All services over RPC |

Two notes on this inventory:

- A printing service is referenced by `docker-compose.yml` and `docker-compose.admin.yml`, but it has no implementation file and no entry point anywhere in the tree. It is dead configuration.
- The transport between services is newline-delimited JSON over TCP (`src/cms/io/rpc.py`), carrying a shared-secret authentication field. The check fails closed: if the secret is unset on the server side, no request is accepted.

## 4. What is actually slow (or rather: what is not known)

**No performance measurement exists in this repository.** There are no profiling artifacts, no recorded benchmark results, no query logs, and no timing harness. The profiling plumbing that does exist (`src/cmstestsuite/profiling.py`) depends on profilers (yappi, line_profiler) that are not installed — they appear in no constraints file. The fork changelog (`CHANGELOG.md`) contains no performance-related entries at all.

What can be cited is structural observation from the source, not measurement. It is presented here so that the eventual measurement work has a starting list — not as evidence of a problem:

- Several places re-query per row where a single joined query would do, with the code's own comments acknowledging the pattern in places:
  1. A per-testcase query in the submission lookup.
  2. Per-submission result loads in the proxy service's database sweep (`src/cms/service/ProxyService.py`).
  3. Per-submission aggregate queries added by the fork's queue-fairness change: `_compute_submission_fairness_delay()` in `src/cms/service/EvaluationService.py` opens a fresh session and issues two queries for every submission enqueued.
  4. A full contest list query on every contestant home page request (`ContestListHandler` in `src/cms/server/contest/handlers/base.py`), which the code's own comment explains is deliberately recomputed per request so new contests appear without a restart.
  5. The contestant submission list and the status polling endpoint both re-query the participation's submissions and compute scores in Python (`src/cms/server/contest/handlers/tasksubmission.py`).
- Every service installs a remote logging handler at INFO level (`src/cms/io/service.py`), so each INFO record becomes an RPC message to the log service — including from the worker mid-grading.
- The contest web server runs as a single process; concurrency is greenlet-based (`src/scripts/cmsContestWebServer`). The compose file caps it at half a CPU and 512 MB by default (`docker-compose.yml`). Note that this cap is a fork choice, not upstream, and that a CPU cap can be the limiting factor rather than the language.

The honest conclusion: none of this establishes that Python is the bottleneck. Query count is not latency; a cap is not a profile; no measurement plan was drawn up and no timing data was collected. Sections 7 and 8 assume this starting position.

## 5. Dependency rot, which is a real and separate problem

The language runtime is not the problem:

- The Python version is not end-of-life. The project requires 3.11 or newer (`src/pyproject.toml`) and the image base ships 3.12.

The frameworks are the actual problem:

- Tornado is pinned to 4.5.3, a 4.x release from 2017 (`src/constraints.txt`, `src/pyproject.toml`). The fork carries a monkey-patch — repeated at the top of dozens of handler modules — with the comment "Tornado 4.5.3 does not work on Python 3.11 by default". The pin is upstream's own, and upstream tracks abandoning it in an open issue.
- SQLAlchemy is pinned to the 1.3 series, which is past end of support. The pin is structural, not incidental: the code relies on string-based loader arguments (for example `joinedload("participations")` in `src/cms/server/admin/handlers/contestranking.py`) that were removed in SQLAlchemy 2.0.

This is the strongest technical argument for investment in the Python stack. But note the asymmetry: upgrading dependencies is a different, bounded, and much cheaper action than rewriting the system in another language, and it should be evaluated first (option 7.3).

## 6. Runtimes in play, and where the boundary already is

Measured line counts of the current tree:

| Runtime | Location | Size |
|---|---|---|
| Python core | `src/cms/` | About 33,150 lines across 135 files |
| Python common library | `src/cmscommon/` | Not separately measured; included in the roughly 37,000-line core figure below |
| Python ranking server | `src/cmsranking/` | Not separately measured; included in the same figure |
| Python contrib tools | `src/cmscontrib/` | About 11,000 lines |
| Python test suite | `src/cmstestsuite/` | About 20,000 lines |
| TypeScript admin panel | `admin-panel/` | About 32,200 lines across 333 files |
| Rust operational CLI | `tools/` | About 3,565 lines across 29 files |
| Shell and container configuration | `scripts/`, `docker/`, compose files, `Dockerfile`, `Makefile` | Not measured here |

Where the boundary already is:

- **The admin path is already split.** A separate TypeScript process (`admin-panel/`) talks to PostgreSQL directly through its own ORM and to Docker for lifecycle actions, while the Python services speak RPC. No Python sits between the admin UI and the database.
- **The ranking path is already split.** A Python writer (the proxy service) pushes scores over HTTP, and a Python reader (`src/cmsranking/RankingWebServer.py`) serves its own in-memory store over HTTP and server-sent events. The two sides share only the HTTP contract.
- **The contestant path is not split.** The contest web server renders HTML in the same process that answers the request, and the grading, language and score-type plugins are imported in-process.

Therefore the architecture claim — frontend and backend in different languages — is already true for admin and ranking. It is not a new idea there; it is the implemented design. It is also not the same claim as rewriting the backend, because the worker, evaluation, scoring and proxy services have no frontend at all: a "frontend/backend split" does not even apply to them, and the frameworks they run on are the same unsupported ones.

## 7. Options, with cost, risk, and what breaks

### 7.1 Do nothing beyond measurement  <-- RECOMMENDED

- **What it is:** instrument the system to produce the measurements in section 8, and change nothing else.
- **Measured surface:** zero lines changed.
- **Cost:** the lowest of any option — engineering time only, no migration, no review burden, no release coordination.
- **Risk:** none to correctness or to the fork constraint. The only risk is spending time on measurement that later shows no problem — which is the system working as intended.
- **What breaks:** nothing.
- **When justified:** always. It is the prerequisite for every other option in this section, and it is the only option that can be started without first resolving the documentation contradiction in section 2.

### 7.2 Do nothing, then targeted optimization of the cited hot paths

- **What it is:** after measuring (7.1), rewrite only the specific query patterns listed in section 4 where the measurements show cost — for example, batching the proxy service's per-submission loads or caching the contest list.
- **Measured surface:** a handful of files: `src/cms/service/ProxyService.py`, `src/cms/service/EvaluationService.py`, `src/cms/server/contest/handlers/tasksubmission.py`, `src/cms/server/contest/handlers/base.py`.
- **Cost:** low in lines, but every change lands in vendored upstream files.
- **Risk:** every edit widens the local diff against upstream and makes the next upstream merge harder — this option trades directly against section 2. Overwritten upstream logic can also silently drop upstream fixes that arrive later.
- **What breaks:** upstream mergeability for the touched files; behavior must be re-validated against `src/cmstestsuite/`.
- **When justified:** when the measurements show a specific path dominating and the fix cannot wait for an upstream change.

### 7.3 Upgrade the pinned frameworks (Tornado and SQLAlchemy) without changing language

- **What it is:** move Tornado from 4.5.3 to a supported release and SQLAlchemy from 1.3 to the 2.x line, keeping Python.
- **Measured surface:** all ORM call sites that use string-based loader arguments become attribute-based; the coroutine-style Tornado handlers move to the current async API; the repeated `collections.MutableMapping` monkey-patches can be deleted outright.
- **Cost:** moderate — broad but mechanical edits across the web servers and db modules, with the roughly 20,000-line test suite as the oracle.
- **Risk:** async API churn in the web servers; merge conflicts concentrated in exactly the files upstream also touches when it does the same upgrade.
- **What breaks:** anything still depending on removed Tornado 4.x APIs, and every string-based loader argument (they are removals in SQLAlchemy 2.0, not deprecations).
- **When justified:** now. The pinned Tornado version is the single most defensible investment in this document: it is unsupported, it already needs a monkey-patch to run on the required Python version, and upstream tracks the same problem. This option does not require resolving the fork contradiction in section 2 first, because it changes dependency declarations and call sites rather than replacing vendored modules wholesale.

### 7.4 Rewrite only the hot services

- **What it is:** replace one or two services (typically the worker, as the presumptive hot path) in another language, keeping the rest Python.
- **Measured surface:** deceptively small and deceptively large at once. The worker entry point (`src/scripts/cmsWorker`) is a thin launcher, but it drags in the grading library — sandbox handling, jobs, task types, score types, languages — on the order of five to six thousand lines. The replacement must also speak the RPC transport (`src/cms/io/rpc.py`) bit-for-bit, because the Python peers that remain must interoperate with it.
- **Cost:** high per service, and it recurs for each service attempted.
- **Risk:** wire compatibility and behavioral equivalence must be maintained by hand; the upstream merge path is lost for every rewritten component and strained for its Python counterparts.
- **What breaks:** any protocol drift breaks mixed Python/non-Python fleets; grading behavior differences are visible to contestants as score changes.
- **When justified:** only when measurements show one service dominating end to end, and options 7.2 and 7.3 demonstrably cannot address it.

### 7.5 Full backend rewrite

- **What it is:** replace the Python backend with another language and framework.
- **Measured surface:** roughly 37,000 lines across `src/cms/`, `src/cmscommon/` and `src/cmsranking/`; a roughly 20,000-line behavioural test suite that can serve as an oracle (though it is itself Python, so it must be adapted or run against the replacement over the wire); 47 recorded schema versions with their per-version updaters under `src/cmscontrib/updaters/` (the schema now stands at version 48 after the fork's addition); and 33 tables governed by row-level security that the replacement must respect or re-implement.
- **Cost:** the highest in this document by a wide margin, and it is paid before the first measurement-backed benefit exists.
- **Risk:** the central one — the upstream merge path is forfeited entirely (section 2). The fork's own Python work (queue fairness, group-based permissions, ranking branding, and whatever else the section 2 diff reveals) must be re-derived and re-verified from scratch.
- **What breaks:** the upstream merge path permanently; every RPC peer relationship; the updater chain; the row-level security guarantees unless they are ported deliberately.
- **When justified:** essentially never on the evidence available today. Even with the section 8 measurements in hand, this option must be justified explicitly against the loss of upstream fixes, not only against its projected performance.

### 7.6 Frontend-only work on the contestant interface

- **What it is:** modernize what contestants experience — page weight, rendering, polling behavior — without changing the backend language. Roughly 2,150 lines of handlers plus templates are in scope. The status polling endpoint already responds with JSON, so client-side rendering can be introduced against the existing API surface.
- **Measured surface:** `src/cms/server/contest/handlers/` and the contest templates.
- **Cost:** moderate.
- **Risk:** low systemically — no service boundary changes — but the touched files are vendored, so the fork diff widens.
- **What breaks:** little; the backend contract is unchanged by construction.
- **When justified:** when measurement shows the problem is perceived UI latency rather than backend throughput — which, on current evidence, is unknown.

## 8. Evidence that would be required before recommending a rewrite

Until the following measurements exist, any rewrite recommendation is guesswork. None of them exists today.

1. End-to-end submission latency, broken down between the synchronous database write and the RPC dispatch.
2. Query count and wall time per contestant page, especially the polled status endpoint.
3. Ranking recompute cost at load, for both the in-memory ranking path and the Python admin ranking path.
4. Query count per submission ingest.
5. Log service RPC volume under load (the INFO-level remote handler in section 4 is the hypothesis to test).
6. Worker throughput against the batch and cache constants in the evaluation and grading configuration.
7. A true diff against upstream at the claimed base revision, replacing the documented three-area claim with a real number of diverged files and lines.

## 9. Recommendation

Adopt option 7.1 first and option 7.3 as the follow-on: measure, then fix dependency rot. The upgrades in 7.3 address the one problem this repository documents itself — an unsupported framework pinned to 2017 and already monkey-patched to run on the required Python — and they do so without touching the fork constraint that dominates every other option. Treat any language migration (7.4, 7.5) as unjustified until the measurements in section 8 exist and show a bottleneck that 7.2 and 7.3 cannot remove. Frontend-only work (7.6) is viable at any time but should be prioritized by the same measurements.

This is a recommendation for a decision that is not this document's to make: it identifies the order of operations and the evidence bar, and the decision itself belongs to whoever owns the trade between upstream mergeability and local rewrite freedom.

Finally, stated plainly: no claim in this document is based on a measurement taken from this system. Every performance statement is structural and cited from source. The figures marked as not independently verified — the commit-era counts, the three-area characterization, the claimed base revision — are exactly the ones that were taken from repository documentation rather than reproduced here.
