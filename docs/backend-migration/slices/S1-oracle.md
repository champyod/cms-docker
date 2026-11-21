# S-1 — the equivalence oracle

**The slice that makes every slice after it checkable.** Nothing in S-2…S-13 can claim "the behaviour
did not change" until this exists, because until then that claim is a self-report.

Read `../PLAN.md` §3 for where this sits and §4 for the brief template. This file is the detail.

## What it must do

Two stacks, one database, one request list, one diff.

1. **Baseline** = this tree's own Python CMS. **Candidate** = whatever branch the slice under test is
   building. The harness must be able to point at either without being edited.
2. Send the same recorded requests at both and compare **status code, headers that carry meaning, and
   response body** — the body normalised only for values that are genuinely per-run (csrf tokens,
   timestamps, generated ids), and every normalisation rule written in one place with its reason.
3. Emit a **diff count** and a machine-readable diff. Exit 0 only on `diff == 0`.
4. **Falsify itself**: with a one-line planted behaviour change, the harness must report a non-zero
   diff and exit non-zero. A harness that cannot fail on a dead input is not an oracle.

## The baseline, measured (2026-11-22, on this lane's base `5f7ac466`)

This is the part that cost the most to establish; do not re-derive it, and do not trust it blindly —
verify the one piece you depend on.

| Fact | Value | How it was established |
|---|---|---|
| The ready-built Python stack is the published image | `ghcr.io/champyod/cms-docker-core:major-admin-panel` | already pulled locally; `docker run --entrypoint sh … ` runs Python 3.12.3 |
| The image ships every service binary | `/home/cmsuser/cms/bin/{cmsContestWebServer,cmsAdminWebServer,cmsLogService,cmsWorker,…}` | `which` inside the image |
| The image's site-packages path | `/home/cmsuser/cms/lib/python3.12/site-packages` | `docker cp` of `/home/cmsuser/cms/lib` enumerates `cms/`, `cmscommon/`, `cmscontrib/`, `cmsranking/`, `cmstaskenv/`, `cmstestsuite/` |
| **The image's Python is NOT this tree** | 4 of 6 areas byte-identical by line count (`cmscommon` 1922, `cmscontrib` 11057, `cmsranking` 2441, `cmstaskenv` 1093); `cms` differs (+82 lines, the image has `admin_security_url` the tree lacks) and `cmstestsuite` differs (15580 vs 22786) | per-area `find … \| wc -l` against both |
| So the baseline must run **this tree's** code | mount `src/<area>` over `/home/cmsuser/cms/lib/python3.12/site-packages/<area>` | the mounted run raises **this tree's** `cms/conf.py` message verbatim, which is the proof the mount took effect |
| A bootable config already exists in the image | `/home/cmsuser/cms/etc/cms-devdb.toml` — real `secret_key`, `url = postgresql+psycopg2://cmsuser:***@database:5432/cmsdb` | `grep` inside the image |
| A docker network for it already exists | `cms-network` | `docker network ls` |
| Postgres images available | `postgres:15-alpine`, `postgres:15` | `docker images` |

**Do not use `ghcr.io/champyod/cms-docker-core:major-admin-panel` as the candidate.** It is the *older*
tree. It is only ever the baseline, and only with this tree's `src/` mounted over it.

## Config the harness must set

- Host `database` must resolve — put a `postgres:15-alpine` container named `database` on `cms-network`.
- Use `cms-devdb.toml` as the config source, copied to `cms.toml` (or `CMS_CFG` if the service accepts
  one — check `cmsContestWebServer --help`). Its `secret_key` is already non-default, which is the
  condition `cms/conf.py` refuses to boot without.
- Schemas must be loaded before the stack answers. `src/cmstestsuite` has the existing way to do this
  (`programstarter.py`); read it before inventing one.

## Where it lives

`scripts/__check_render_parity.sh` — a gate, so it is permanent, reviewed like code, with a test and
its negative control. Not a scratch script, not a Rust test inside a crate that S-2 will delete.
Supporting fixtures (the request list, the normalisation rules) go beside it under `scripts/parity/`.

## Acceptance criteria

1. `scripts/__check_render_parity.sh --baseline-only` boots the Python stack from this tree's `src/`
   and exits 0 after recording at least one response per surface in the list below.
2. `scripts/__check_render_parity.sh` against the same tree twice reports `diff == 0` (a stack compared
   with itself must agree — this is the harness's own sanity, and it catches a non-deterministic
   normalisation).
3. It **fails** on a planted change: flip one user-visible value in the tree (e.g. a page title, a
   status code) and it must report a non-zero diff and exit non-zero. Paste both the number and the
   exit code in the handback.
4. The request list covers, at minimum: contest landing, task list, submission list, login, a
   permission-denied response, and one admin surface. Enumerate what it actually covers in the handback
   — not what was intended.
5. No new runtime dependency for the shipped product. Docker, `curl`/`python3` in the harness are fine.

## Out of scope

- Do not edit `admin-panel/**` or `docs/DESIGN*.md`.
- Do not change the RPC protocol, the schema, or any service's behaviour. This slice only measures.
- Do not port anything to Rust. Rust arrives in S-2 onward.

## Report

Command, exit code, counts, one line of what it proves — per `docs/agent-protocol.md` §1. End with what
landed (SHA), what is blocked (named), what is next.
