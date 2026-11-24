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
| S-5 | **`cms.grading`** (43 files, 8,452 — measured at `04db7ec8`: **643 ported, 5,598 partial, 2,211 absent**; ≈3,357 lines remain to port, `dev/migration/S5-gap.md`) | 8,452 | S-3 | The six gaps in `S5-gap.md` close in order: the judge that turns an answered run into an outcome (`S-5a`), the 13 language impls (`S-5b`, **merged** `dca96d28`: one struct and one file each, operator's choice over a data table), `Communication`/`TwoSteps` compilation (`S-5c`, **merged** `3acc02b5`), `scoretypes/` (`S-5d1`, **merged** `779a65cc`) + `scoring.py` (`S-5d2`, **merged** `1aa8ffac` — S-5's scoring is complete), the job executor and a `cms-worker` binary (`S-5e`), sandbox write confinement (`S-5f`). `cms-worker` already holds 7,611 lines modelled on grading; a blind port would duplicate it. The worker executes one real submission end to end through the Rust path. |
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
| 2026-11-22 | `feat/rust-proc-reader` | `81f45804` | `cargo test -p cms-svc` → 68 passed; parent's own mutation of `procfs_reader.rs:36` (`swap_used` → plain `swap_free`) failed **no** test, so the parent added the swap identity and a per-key memory comparison; the same mutation now fails at exit 101 | `ef3ceadc` |
| 2026-11-22 | `feat/rust-resourcesvc` | `c982c182` | `cargo test -p cms-svc` → 99 passed; parent's own mutation of `machine.rs:122` (`round_ties_even` → `round`) failed `percentages_round_like_python` with left 3 / right 2, exit 101, restored byte-identical | `d800accd` |
| 2026-11-22 | `feat/rust-resourcesvc-sup` | `52406c1e` | `cargo test -p cms-svc` → 119 passed; parent's own mutation of `naming.rs:28` (dropped the hyphen) failed 6 tests including the round-trip, with "autorestart would spawn /opt/cms/bin/cmsworker 0 -c 7 and then not see it", exit 101; process count before/after a full serial run was 1/1, so the suite spawned nothing | `39cc28f3` |
| 2026-11-22 | `feat/rust-resourcesvc-bin` | `a72c4686` | `cargo test -p cms-svc` → 136 passed; `bash scripts/__test_config_sync.sh` → 42 passed; parent's own mutation of `cms-resource-service.rs:141` (malformed `CMS_AUTORESTART` allowed to read as false) failed `an_unreadable_autorestart_value_is_refused_rather_than_read_as_false`, exit 101, restored byte-identical | `99e89a73` |
| 2026-11-22 | (main session) | `af1e0128` | container wiring: `docker compose --profile core config` exit 0 with 8 `CMS_SERVICES` lines intact; `__test_config_sync.sh` 42, `test_image_pins.sh` 77, `test_security_profiles_enable.sh` 114 pass/0 fail; the Dockerfile's build line produces both binaries | `af1e0128` |
| 2026-11-22 | `feat/rust-S2a-crypto-core` | `1fd7f8cc` | **B1 approved by the operator**: `aes` 0.8, `bcrypt` 0.17, `base64` 0.22. Parent's own mutation of `crypto.rs:413` (padding terminator `0x01`→`0x00`) failed 3 tests including `the_cipher_reproduces_the_python_ciphertext_byte_for_byte`, exit 101; restored byte-identical, `cms-db` 94 passed | `2f1337db` |
| 2026-11-22 | `feat/rust-S4-retire-cmsranking` | `b15ebf92` | `src/cmsranking` deleted; 395 Python files remain (was 409). Conflict on 3 rebranded images resolved by deletion after confirming `ranking-web/static/img/` carries the identical brand bytes | `6eaedd21` |
| 2026-11-22 | `feat/rust-S3a-session` | `a2140d61` | first S-3 piece: actor, session, base, drop. `cargo test -p cms-db` → 125 passed, but **the live half skips without `CMS_DB_TEST_URL` and a skip is reported as a pass** — so the parent started `postgres:16-alpine` on 127.0.0.1:15433 and ran them for real: `a_commit_and_a_second_begin_stamps_again` passed, and all three FAIL against a dead port, so they cannot skip silently once the URL is set. Parent's own mutation of `actor.rs:143` (admin id `1..=9`→`1..=10`) failed `every_malformed_shape_is_refused`, exit 101, restored byte-identical | `c07e695a` |
| 2026-11-22 | `feat/rust-S3b-files` + `feat/rust-S3c-users` (parallel) | `9bc48370` / `066a40b4` | file store 1,391 + identity 1,096. Only `lib.rs` conflicted; the resolution dropped the `large_object` re-export and **`cargo check -p cms-db` still passed**, because check does not build test targets and `tests/large_object.rs:14` imports `LargeObject, LargeObjectError, Mode` from the crate root — caught by running the tests. Parent's own mutation of `database.rs:100` (removed the losing writer's `LargeObject::unlink`) failed `a_competing_insert_leaves_one_row_and_no_unlinked_bytes` with "the losing writer's large object was left behind", left 1 / right 0, exit 101, restored byte-identical | `7408c34d` |
| 2026-11-22 | (main session) | — | that dedup test asserted the orphan count over the **whole database**, so one failed run poisoned every later run until the database was dropped — I mistook a restored file for a broken one. Scoped to a floor captured at test start; re-proven three ways: passes with a pre-existing `lo_create` orphan, FAILS with the unlink removed, passes restored | `50a37ea3` |
| 2026-11-22 | `feat/rust-S3d-submissions` + `feat/rust-S3e-contest` (parallel) | `1c6741d4` / `16520948` | task 646 + submission 799, contest 499 + usertest 550. **Both lanes were green alone and the merged tree did not compile** (`E0252: TokenMode defined multiple times`) — each had redeclared the same enum; see the fix row below | `d8e75868`, `5432c958` |
| 2026-11-22 | (main session) | — | consolidated the duplicate `TokenMode` into `cms-db/src/token_mode.rs` (one concept: `contest.py:157` and `task.py:133` use the same constants and differ only in default). Parent's own mutation of `quota.rs:65` (infinite balance refusing as if zero) failed `an_infinite_task_always_offers_a_token` and `two_unlimited_sides_stay_unlimited`, exit 101, restored byte-identical. 104 binaries, 714 passed with a live database | `8549667f` |
| 2026-11-22 | `feat/rust-S3f-util` | `8422a988` | contest/service binding + bootstrap. Parent's own mutation of `binding/active.rs:74` (an empty `is_active` flag made to bootstrap from `CONTEST_ID`) failed `a_fresh_install_is_bootstrapped_only_while_the_table_is_missing`, exit 101, restored byte-identical. Merged tree: 108 binaries, 736 passed, live database | merged |
| 2026-11-22 | `feat/rust-S3g-reads` | `dd53f811` | the deferred 244 lines. Parent's own mutation of `reads/walk.rs:64` (`!submissions && !users` → `||`) failed `the_walk_visits_every_table_and_honours_each_skip`, leaking digests …0006 and …0007 into a walk "without users", exit 101, restored byte-identical. Merged tree: 113 binaries, 760 passed, live database | `4df2295e` |
| 2026-11-22 | `feat/rust-S3h-schema` | `70945d9f` | closes the three gaps: schema creation (DDL obtained by running the reference and dumping it, frozen at `dev/fixtures/cms_schema.sql`, 224 statements split into `cms-db/sql/`), username display/registration, and the team fallback. Parent's own mutation of `username/policy.rs:72` (removing the contest short-circuit) failed `a_contest_denial_is_not_reopened_by_a_user_allow` and `a_contest_policy_decides_for_every_participant`, exit 101, restored byte-identical. Merged tree: 117 binaries, 772 passed, live database | `be01014e` |
| 2026-11-22 | `feat/rust-S3i-pgdump` | `7bb3952f`→`d7b453fe` | dumper from the prod-pinned image, fixture regenerated on PG 15, version check made strict. Parent's own control: the first attempt (deleting a FOREIGN KEY statement) proved only that the DDL runs, not that the comparison sees anything — repaired to `CASCADE`→`RESTRICT`, which failed at statement 187 with "224 statements expected, 224 created", exit 101, restored byte-identical. Merged tree: no host `pg_dump`, 117 binaries, 772 passed | `2461a695` |

Gate on the tree after all fifteen merges (`7408c34d`, plus the test fix `50a37ea3`), with a live
database: `cargo fmt --check` exit 0; `cargo clippy --all-targets -- -D warnings` exit 0; `cargo test --
--test-threads=1` → 89 test binaries, 570 passed, 0 failed, 2 ignored, exit 0; `bash
scripts/__test_config_sync.sh` → 42 passed, exit 0; `bash scripts/__check_agent_protocol.sh` → exit 0;
`docker compose config` → exit 0. Serial because the parallel run hits the pre-existing `ETXTBSY` race on
`backend/target/tmp/**/isolate` (`sandbox_launch.rs:79`, `sandbox_drain.rs:57`) — recorded, not fixed.

**`cargo check` is not a gate (learned 2026-11-22).** Resolving the S-3b/S-3c merge in `lib.rs` dropped the
`large_object` re-export and `cargo check -p cms-db` still exited 0 with no error count, because `check`
does not build the test targets. `cms-db/tests/large_object.rs:14` imports `LargeObject, LargeObjectError,
Mode` from the crate root, so the omission only appeared when the tests compiled. Check the tests, not the
library: `cargo clippy --all-targets` and `cargo test`, never `cargo check` alone.

**The copy loop that stopped yielding — RESOLVED (2026-11-22, operator-approved, `b244a8ad`).** The S-3b
report said "gevent: nothing to become", and `store.rs`'s own module doc asserted the same thing: "has no
counterpart and needs none". Both were wrong. `filecacher.py:73`, `:76` and `:774` call `gevent.sleep(0)`
after every chunk, `:774` commented "Cooperative yield", so a large copy does not starve the greenlets
sharing the service. The port had **no suspension point at all** on the file-to-backend path: `Writable::
File::write_all` is a blocking write that returns immediately and `io::Read::read` never suspends, so a
multi-gigabyte copy held its worker for the whole transfer — and submissions are exactly such files. The
doc comment is how the gap survived review, so it is now rewritten to say what the code does and why.

The decision was the operator's because it adds a manifest dependency: `tokio` is now a `cms-db`
dependency, declared once in `[workspace.dependencies]` and referenced by both `cms-db` and `cms-audit`
(the inline version it carried before moved into the same table, so one line owns the version). No crate
entered `Cargo.lock` — it was already there through sqlx's `runtime-tokio`.

The test makes the yield observable rather than assumed: on a `current_thread` runtime a spawned task can
only run if the copy gives the scheduler a turn, so removing the yield fails with "the copy never gave the
scheduler a turn, so it held its worker for the whole transfer" — seen, then restored.

**A skip is reported as a pass, so a green count can prove nothing (found 2026-11-22, S-3a).** The live
database tests return early when `CMS_DB_TEST_URL` is unset, and the harness records that as `ok` — the
lane's `125 passed` and the parent's first `passed=125` both included them without exercising them.
`drop_db` even reported `1 passed` while doing nothing. The check that settles it is to run the suite
against a real server and then against a dead one: start `postgres:16-alpine` on 127.0.0.1:15433 with
the database named to contain `test` (drop refuses anything else), export
`CMS_DB_TEST_URL=postgres://cmsuser:testpass@127.0.0.1:15433/cmsdb_test`, and point the same variable at
a dead port to confirm the tests **panic** rather than pass. Every later S-3 epic will add live tests;
run them this way before believing a count.
**Still open:** `.github/workflows/ci.yml` only `cargo-deny`s `backend/` (line 904) and its identity job
drives the Python suite, so no CI job runs those tests — the proof stays CI-invisible until a backend job
carries a postgres service.

**B1 is resolved (operator, 2026-11-22): `aes` 0.8 + `bcrypt` 0.17 approved, `base64` 0.22 already
transitive.** The rejection reasons are recorded because they are the reason there was no table: openssl
supplies AES-CBC but no bcrypt and drags a C toolchain into the image build; ring and aws-lc-rs expose
AES but have no bcrypt at all; hand-writing either is the thing the quality bar forbids. With it, S-2a
merged (`2f1337db`) and S-4 merged behind it (`6eaedd21`), which unblocks **S-3** (`cms.db`, 6,816
lines) — the largest remaining slice, and the one everything else in the service tier waits on.

**This landing branch is shared with a frontend writer (observed 2026-11-22).** `60eb668d`
("feat(patterns): five page archetypes…", author another Hermes session, 15:55) sits on
`feat/rust-trunk-reconcile` above `cb4b6a3c`, and two `admin-panel/` files were left modified in this
worktree at the same time. Its scope is frontend-only — `git show --name-only 60eb668d` lists nothing
under `backend/`, `src/`, `scripts/` or `dev/` — so it does not endanger the port and is left untouched,
per the rule that another writer's work is read-only. Recorded because it means a merge from this lane
carries frontend commits too: read `git log <base>..feat/rust-trunk-reconcile --name-only` before
describing a merge as backend-only.

Notable in the S-2a port: the padding is **not** PKCS#7 — one `0x01` byte then `0x00` to the block
(`crypto.rs:18`), with the strip reproducing `pt_pad.rstrip(b"\x00")[:-1]`. That is also why the `cbc`
crate was not used: its padding traits describe a scheme this data never used, so chaining is done over
the vetted `aes` core. The cipher is byte-compatible on purpose, because existing ciphertext is already
in the database; the missing MAC remains a named finding (F3), not something the port silently fixed.

### S-3 epic split (the remaining order, recorded so it is not re-derived)

`src/cms/db` is 6,816 lines across 22 files, split by measured size and by import direction:

| epic | files | lines | state |
|---|---|---|---|
| S-3a | `actor` 183, `session` 154, `base` 330, `drop` 84 | **751** | **merged** (`c07e695a`) |
| S-3b | `fsobject` 437 → `filecacher` 954 (filecacher imports `FSObject`, `LargeObject`) | **1,391** | in a lane |
| S-3c | `user` 439, `username/models` 175, `username/resolution` 211, `permissions` 145, `admin` 70, `security_block` 56 | **1,096** | in a lane, independent of S-3b |
| S-3d | `submission` 799, `task` 646 | **1,445** | **merged** (`d8e75868`) |
| S-3e | `contest` 499, `usertest` 550 | **1,049** | **merged** (`5432c958`) |
| S-3f | `util` 568, `__init__` 175 | **743** | **partial** — 244 lines deferred, see S-3g |

The arithmetic, computed rather than asserted: 751 + 1,391 + 1,096 + 1,445 + 1,049 + 743 = **6,475**, plus
`types.py` **248** (already ported into `cms-db`'s `types.rs` long before S-3), `init.py` **52** and
`username/__init__.py` **41** = **6,816**, which is the `wc -l` total. Nothing in the slice is unassigned.

**S-3 IS NOT COMPLETE — 244 lines of `util.py` were deferred by decision (2026-11-22).** The lane ported the
binding half (`_read_service_binding`, `service_binding`, `active_contest_id`, `_bootstrap_contest_id`,
`contest_binding`, `_resolved_contest`) and deliberately left six reads, on the stated ground that they read
other lanes' tables and would re-create the mixture `util.py` already suffers from. That reasoning was
sound when it was written and is now obsolete: every one of those tables has since landed (`task/`,
`submission/`, `contest/`, `filecache`, `fsobject`). Measured, not estimated:

| function | lines | span in `util.py` |
|---|---|---|
| `get_contest_list` | 19 | 83-101 |
| `is_contest_id` | 11 | 102-112 |
| `get_submissions` | 60 | 355-414 |
| `get_submission_results` | 68 | 415-482 |
| `get_datasets_to_judge` | 23 | 483-505 |
| `enumerate_files` | 63 | 506-568 |
| **total** | **244** | |

So S-3's queue is S-3g for these six, and only then is the slice done. Also deferred and stated: the two
interactive prompts (`ask_for_contest:113`, `ask_for_active_contest:296`) belong to the CLI crate that asks
them, not here; and the five-second registry TTL cache was dropped, so every binding read is the database's
current answer — a behaviour change worth knowing when a caller expected the reference's staleness.

**S-3 IS STILL NOT COMPLETE — the "every function has a counterpart" claim was false (2026-11-22).** The
S-3g lane reported that every function in `src/cms/db` now has a Rust counterpart, and the merge message
repeated it. A mechanical check — every module-level `def` in the 21 Python files compared against the
crate's `fn` names — found 20 without a verbatim counterpart. Most are covered under another name or by the
type system, and four were deliberately left out (the two interactive prompts, `test_db_connection`,
`custom_psycopg2_connection`). Three are genuine gaps, measured:

| gap | where | size |
|---|---|---|
| **schema creation** — nothing in Rust can create the tables | `init.py:40-52` (`init_db`) plus the DDL compilers `types.py:79-248` (`compile_codename`, `compile_filename`, `compile_filename_schema`, `compile_filename_schema_array`, `compile_digest`), ~170 lines that exist only to emit `CREATE TABLE` | ≈180 lines |
| **username display and registration** — `get_display_usernames`, `get_display_username`, `get_display_name`, `username_config_allowed`, `set_display_username` and their private helpers `_find_record`/`_assert_username_free`/`_append_history`/`_create_username`/`_update_username` | `username/resolution.py:94-133`, `:134-184`, `:185-211` | ≈111 lines |
| **`registerable_teams_query`** — a contest decides, else the team's own flag | `user.py:165-178` | 14 lines |

Confirmed *not* a gap: `resolve_username_config` is ported as `resolve_config` (`username/policy.rs:68`).
The schema gap is the serious one: a fresh deployment cannot initialise a database from Rust, so the Python
tree cannot be deleted while it stands. Queued as **S-3h**.

### Crate layout: `cms-worker` is three crates, and the split is measured (2026-11-23)

`ARCHITECTURE.md` names 16 crates and the tree had 5 because `cms-worker` was carrying three of
them at once. The split is now evidence-driven, not scheduled by taste:

| crate (ARCHITECTURE.md) | contents | state |
|---|---|---|
| `cms-sandbox` (:24) | `sandbox/` 1,641 + `measure` + `stats` | **extracted** (`60271227`) |
| S-5e2b job body bridge | `from_body` readers + `write_body` writers; the input/result seam the worker loop needs | **merged** `b6a0ba5e` (see note) |
| S-5e3a execution port | `execute::compile`/`evaluate` over the five task types; configuration refusals become failed results | **merged** `2aa1c228` (see note) |
| S-5e3a2 sandbox archives | `archive_sandbox` calls `Stage::archive`, files a digest map on every result, and deletes independently of keep | **merged** `a5e10c98` (see note) |
| S-5e3b worker execution layer | raw body to typed job to result body; `execute_job_group` envelope, shard stamp and error sentences | **merged** `187b4cf7` (see note) |
| S-5e3c worker binary | environment settings, runtime over `fs-cache-shared`, host binding, `echo`/`quit` lifecycle | **merged** `36b9595b` (see note) |
| S-5e3d worker precache | `precache_files` over `cms_db::FileCache`, shared lock, contest digests and missing-file pass-over | **merged** `1c54022d` (see note) |
| S-5e3e worker deployment | Dockerfile build/copy, compose command/env/healthcheck and config-sync sandbox rendering | **merged** `6bdfee9c` (see note) |
| S-5e3f worker keep | `KEEP_SANDBOX` at every grading close, independent of archiving | **merged** `8233f065` (see note) |
| S-6a outbound client | `cms-svc::Client` connect/call/echo, correlation ids, secret omission | **merged** `9a4a4cfd` (see note) |
| S-6b checker | all-services rows, 90-second liveness rounds, `cms-checker` binary and container entrypoint | **merged** `901a35af` (see note) |
| S-6c1 score details | exact `score_details` / `public_score_details` JSON for Sum and Group | **merged** `aaa394d5` (see note) |
| S-6c2 scoring core | dataset score fields plus pure `score()` producing a `ScoreRow` | **merged** `9cf76eff` (see note) |
| S-6c3 scoring io | candidate discovery, transaction bundle read and score upsert | **merged** `1eb276c0` (see note) |
| S-5e2a task registry | `TaskType::of(key, params)`; the class-name key vs the human label | **merged** `dd37dd47` |
| S-5e1 method context | `Method<C>` + generic `dispatch`/`Registry`/`Host`; the refactor that unblocks the worker | **merged** `e07a3ec2` |
| S-8b submissions_status | the dashboard's status counts; the reconciliation bucket | **merged** `d69cc587` |
| S-8a admin RPC authorization | `cms-api` crate + the three tiered allowlists; deny-on-wildcard demotes | **merged** `dbff4afb` |
| S-5h parameters | value validation at construction; the silent not-grader fallback | **merged** `c908c696` |
| S-5g messages | `messages.py` table + the `%s` arity contract; the missing-output defect | **merged** `b4966c79` |
| S-5f write confinement | `allow_writing_only` + the symlink-out refusal the reference gets wrong | **merged** `a92a5e2f` |
| `cms-grading` (:25) | job model, **scoring**, language + task-type registry — `tasktypes` 3,763 + `job` 710 + `stage` 734 + `languages` + `steps` | **extracted** (`15ff7cfc`) |
| `cms-svc-worker` (:28) | the service that executes job groups | **library, binary, precache, deployment and keep merged** (`8233f065`); actual deploy open |

The extraction was mechanical **because it was measured first**: `sandbox/` referenced
`crate::tasktypes` and `crate::job` nowhere, while `tasktypes/` referenced `crate::sandbox` in
8 files — one direction, no cycle. The proofs that it is real, each run rather than asserted:
`grep -rn 'crate::sandbox' backend/cms-worker/src | wc -l` → 0; `cargo tree -p cms-sandbox`
names no `cms-worker`; and no re-export shim exists, which is the way a split silently un-splits.

**Consequence for S-5d, and it is why the order changed.** `scoretypes/` and `scoring.py` are
"scoring" in `ARCHITECTURE.md:25`, so they belong in `cms-grading` — a crate that did not exist.
Porting 1,197 lines into `cms-worker` would have meant moving them again the moment the split
landed. So the queue is `cms-sandbox` → `cms-grading` → **S-5d into `cms-grading`** →
`cms-svc-worker` → S-5f → S-5g. Build order, no behaviour change, decided from the record rather
than asked.

**One architecture line is aspirational, and that is recorded not fixed:** `cms-sandbox` does not
depend on `cms-proto` (`ARCHITECTURE.md:24` says it does). The moved code names nothing from it,
and an unused dependency is exactly what the new-code bar forbids; it arrives with the epic that
gives the sandbox a proto type. Verify with `sed -n '/^\[dependencies\]/,/^\[/p' backend/cms-sandbox/Cargo.toml`.

**S-3 IS CLOSED (2026-11-22, `be01014e`) — verified by re-running the check that found the gap.** The same
mechanical comparison (every module-level `def` in the 21 Python files against the crate's `fn` names) now
leaves 10 without a verbatim counterpart, and each was checked rather than waved through:
`registerable_teams_query` → `registerable_teams` (`team.rs`, with the `COALESCE` fallback);
`get_submission_results_for_dataset` → subsumed by the dataset criterion on the results query;
`actor_sql`/`apply_actor`/`apply_actor_session` → the stamping SQL constants and `Session::begin`;
and the five `compile_*` → replaced by the frozen DDL, because with the schema dumped from the reference
there is nothing left for a DDL compiler to emit. Four are deliberately unported (the two interactive
prompts, `test_db_connection`, `custom_psycopg2_connection`).

### Working rules binding every step (operator's standing instruction)

These govern how this migration is driven, not what it builds. They were each broken once in this session and
each broke something:

1. **One question per form.** Never batch several decisions into one call, even when they are independent and
   each answers by a click. A `clarify` call carries exactly one question, whose choices are readable on their
   own — no "option 1", no pointer to a file, a key or a paragraph above.
2. **A timeout is a wait, never an answer.** Re-issue the same question verbatim until it is answered. Do not
   re-decide whether to ask, do not narrow the choice to the part that looks like code, and never treat a
   keystroke or a silence as consent. If the eventual answer differs from what was already built, change the
   build.
3. **Never skip a decision.** No decision is closed by an argument that it was really mine; the classification
   of a decision is itself a decision for the operator when it concerns dependencies, hosts, schemas or
   anything one `git revert` cannot undo.

**Confirmed decision (operator, 2026-11-22): the schema gate keeps option 1** — `pg_dump` from the
`postgres:15` image it already pins, docker on the machine that runs the test, nothing installed on the host.
Chosen over installing `postgresql-client-15` (a manual step no install or update script performs, and one
that drifts against the server) and over a catalogue rewrite (same facts, but exact DDL text lost). Already
in the tree as merged; no code change follows from the answer.

**The schema gate's prerequisite — RESOLVED, and it was worse than a missing tool (2026-11-22, `2461a695`).**
The gate needed a `pg_dump` matching the fixture's author on `PATH`, this host had none, and it passed only
because a binary sat in `~/.hermes/cache/scratch` — pruned daily. Chasing that turned up the real defect: the
fixture had been dumped from **Postgres 16.16** while production runs the pinned **postgres:15**
(`docker-compose.yml:132`), so the port was validated against a spec generated on a version the deployment
does not run.

Both are closed by running the dumper from the image production runs — the same pin, read out of
`docker-compose.yml` rather than copied — and regenerating the fixture on 15. The comparison has no host
dependency now: verified with `command -v pg_dump` empty and the suite green at 117 binaries / 772 passed.
`docker` becomes a stated prerequisite of that one test path, which it already was of the test database.

**The finding worth keeping: nothing in the compared spec moved between 15 and 16.** 224 statements either
way, stripped comparison byte-identical. The 27-line full-file diff is three non-schema things — the version
header, the per-dump `\restrict` nonce, and 23 sequence owners that pg_dump 16 writes as `ALTER SEQUENCE`
while 15 writes as `ALTER TABLE`. So the fixture's provenance was wrong without the spec being wrong, which
is why no test could have noticed.

Lesson, recorded because it cost a false claim in a commit message: "the child said every function is
covered" is a claim. Compare the Python `def` list against the crate's `fn` list mechanically; the two
names that made me doubt the check (`resolve_username_config` → `resolve_config`, `copyfileobj` →
`copy_to_file`) were both covered, and the gap was somewhere I had not looked.

Two ordering facts that are not obvious from the sizes: `filecacher` must follow `fsobject` because it
imports `FSObject` and `LargeObject`, and S-3d must follow S-3b for the same reason through the cache.

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

### 7.4 `ResourceService` — split in two, and the matcher it changes (2026-11-22)

The service is 481 lines and mixes two different risk classes, so it is two epics:

1. **read-only half** — `_store_resources` (306-398), `get_resources` (402-419), `toggle_autorestart`
   (447-481), and `ProcessMatcher._is_interesting_command_line` (119-159). Samples and reports; starts
   nothing.
2. **supervision half** — `_restart_services` (211-...), `_launched_processes`, `subprocess.Popen`, and
   `kill_service` (423-445), which makes an RPC call to another service. **This one starts processes**,
   so it gets its own gate and its own negative control.

**The finding that makes this more than a transcription:** `_is_interesting_command_line` recognises a
service only as a **Python** command line — it requires `"python" in cmdline[start_index]` and then
matches `^<BIN_PATH>/cms([a-zA-Z]+)$` against the next argument. Every Rust service is a binary like
`cms-log-service`, so a faithful port would find **nothing**, and during the transition both kinds run.
The port must therefore carry the Python rule *and* add the binary rule, or the first swapped service
silently vanishes from `get_resources` — the panel would show it as not running while it serves happily.

Checked, and confined here: no other code identifies services by command line. The `cmdline` matches
elsewhere are `cmscommon/commands.pretty_print_cmdline` (formatting) and `src/setup.py:121-125` (the
Python entrypoint list, which disappears with the tree).

Exact shapes the port must reproduce, because they are not symmetric in the original:
`memory` values are **float** divisions by `B_TO_MB = 1_048_576` (line 49, 341-348), while
`resident`/`virtual` are **integer** divisions (374-375). `ram_available` is the reader's **free**
bytes, not `available` (342). Retention is `MAX_RESOURCE_SECONDS = 11 * 60` (51).

**The hazard the matcher change creates, and the reason the two halves must agree.** `_restart_services`
builds the command it spawns as `os.path.join(BIN_PATH, "cms%s" % service.name)` (`:255`) — a Python
entrypoint name such as `cmsScoringService`, while the Rust services are binaries such as
`cms-log-service`. If the spawner keeps the Python naming and the matcher learns only the binary naming,
autorestart spawns a process its own matcher cannot see, concludes the service is still down on the next
pass, and spawns again — **an unbounded spawn loop**, 5 seconds apart (`:205-209`). The two rules are
therefore one decision, and the round-trip ("a command the spawner builds is recognised by the matcher")
is the test that holds it.

Guard order in the original, all of which the port must keep (`:229-250`): skip `LogService`,
`ResourceService`, and `ProxyService` without a contest id (`:231-235`); skip when `will_restart` is
false (`:239-240`); re-find the process if the held one is gone (`:244-247`); spawn only when it is
*still* not running — the case the comment at `:216-220` explains, where the operator started a service
by hand and a second copy would duplicate it.

**Where the service's own inputs legitimately come from** (a correction to the binary brief, worth
keeping because the same mistake will recur for every service): only `[services]`-derived values belong
in `config sync` — `RESOURCE_SERVICE_ADDR`, `RESOURCE_SERVICE_COORD`, `CMS_SERVICES`. `autorestart` and
`contest_id` are **constructor arguments that never appear in `cms.toml`**
(`ResourceService.py:168-178`), and this deployment passes neither: `docker-compose.yml` starts the
container as `cmsResourceService ${RESOURCE_SERVICE_SHARD:-0}`, with no `-c`. They are therefore optional
environment inputs supplied at container-wiring time, with Python's defaults — autorestart false,
contest id empty — and a missing contest id is the **normal** case, not a failure. `bin_path` needs no
input at all: the running executable already knows its own directory.

**Operator-visible finding while wiring the container (2026-11-22): the service is started but never
queried, and in this topology it cannot see what it is supposed to sample.**

- Nothing in the panel calls it. `grep -rn 'get_resources\|toggle_autorestart' admin-panel/` returns **no
  files**; the only mentions of `ResourceService` are a documentation string
  (`ServicesSection.tsx:20`) and a name in the wiring contract's expected list
  (`service-wiring-contract.ts:17`). Port 28000 appears **only** in `docker-compose.yml` — the publish
  at `:222` and its own healthcheck at `:236`.
- `resource-service` is `privileged: true` (`docker-compose.yml:229`) but does **not** set `pid: host`;
  only `monitor` does (`:864`). A container without the host PID namespace sees only its own processes.
- The service table addresses services by **container name** (`config/cms.sample.toml`:
  `LogService = [["cms-log-service", 29000]]`), and `_find_local_services` keeps the ones whose resolved
  address equals the caller's own — which, when each service is its own container, is `ResourceService`
  alone. So `_restart_services` has nothing to supervise and a sample describes one process.

The port reproduces this faithfully rather than silently "fixing" it, because changing what the service
observes is a deployment decision, not a porting one: it needs either `pid: host` on this container or a
move to host-level metrics. Monitoring in this deployment already runs elsewhere — `config/prometheus/`,
`config/grafana/` and `monitor_targets.json.example` with `MONITOR_ENHANCED=1`. **Recorded for the
operator; not changed here.**

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

### Resolved: the schema gate (2026-11-23)

Not a missing tool. The checker already takes `pg_dump` from the compose-pinned image
(`backend/cms-db/tests/support/pg_dump.rs:26-46`, `docker run --entrypoint pg_dump`); the
failure was a **server version** mismatch — I had brought the test database up on
`postgres:16-alpine` while docker-compose pins `postgres:15` (pg_dump 15.20 refuses a 16.16
server), and `dev/fixtures/cms_schema.sql` was itself dumped by 15.20.

Run the live gate against the version the deployment actually pins:

```
docker run -d --rm --name cms-schema15 -e POSTGRES_USER=cmsuser \
  -e POSTGRES_PASSWORD=… -e POSTGRES_DB=cmsdb_test -p 127.0.0.1:15444:5432 \
  --tmpfs /var/lib/postgresql/data postgres:15
CMS_DB_TEST_URL='postgres://cmsuser:…@127.0.0.1:15444/cmsdb_test' cargo test -- --test-threads=1
```

**153 targets, 933 passed, 0 failed.** The gate is not weakened: `schema_check.rs` still
compares statements against the frozen dump, and the version check that made this visible is
the reason a 16 server cannot silently pass.

### S-5e2b landed inside another writer's commit

The bridge is on the landing branch, but its merge commit is `b6a0ba5e` — subject
`refactor(stats): colour only state counts`, authored by a concurrent writer in the shared
worktree while this lane's merge was staged. Its two parents are `8e3758d2` and `52818b79`
(the lane tip), and `git diff --stat 52818b79 b6a0ba5e -- backend/` is empty, so the backend
tree is exactly this lane's and nothing of it was lost or altered. The subject does not
describe it; rewriting a shared commit is not this lane's to do, so the fact is recorded
here instead. Gate on the merged tree: 155 targets, 955 passed, 0 failed.

### S-5e3a: the execution port, and what it still does not carry

`execute::compile` and `execute::evaluate` now dispatch a typed job to the task type
its `task_type` row names, over the five variants. The lane is four commits
(`74081be8`, `ca57cee6`, `a805598b`, `3dc16236`) merged as `2aa1c228`; its own gate
was **54 targets, 267 passed, 0 failed**, and the merged-tree gate is recorded below.

The parity point that shaped it: `set_configuration_error` (`util.py:123-142`) writes
`success=false`, `text=null` and `compilation_success`/`outcome=null` on the job and
returns normally. Rust task types return `TaskError::TooFewFiles`, `MissingManager`
and `UnexpectedExecutables`; the port turns exactly those three into a failed result
and leaves every other refusal as a group failure. `text` became optional on
`Compilation` and `Evaluation` so null and an empty list are different values.

Two defects were found by review after the lane's first green gate and fixed in
`3dc16236`: `BatchAndOutput` was requiring a toolchain before it had decided whether
it compiles at all (the reference returns before `get_language` for an answer-only
compilation and for a carried or listed output-only testcase), and a failed
Communication `Verdict` was serialising `text: []` instead of `null`.

That gap is closed by S-5e3a2 below: `Stage::archive` (`stage/archive.rs:88`) is now
called by every task type that can archive, and `write_body` writes the digest map.
Strict rustdoc still fails on a pre-existing unresolved `Cache` link at
`tasktypes/mod.rs:43`, unrelated to these slices and left alone.

Merged gate: **158 targets, 973 passed, 0 failed, 2 ignored**. The two ignored are
the `TZ=Asia/Bangkok` child probes `probe_local_reading` and `probe_utc_now`, which
run only from their parent tests; no suite was skipped.

### S-5e3a2: archives are filed, and keep is a separate decision

The lane is five commits (`6aa30cdf`, `cee801c8`, `343bd578`, `70694c62`, `337aa987`),
merged as `a5e10c98`; its own gate was **57 targets, 276 passed, 0 failed**. Every
task type that closes a box now calls `Stage::archive` when `archive_sandbox` is set,
files the packed directory under its digest, and records that digest under the same
root path the sandbox list names. `write_body` writes the map as `sandbox_digests`,
including the checker box an output-only comparator creates.

Two review defects shaped the slice. A first attempt deleted 736 comment lines across
16 files and replaced module docs with one-liners; it was rejected and every comment
restored verbatim, with the hard check `git diff … | grep '^-.*//'` producing zero.
`archive_sandbox` was also being used as `keep`, so every successful archived box
stayed on disk; the reference archives and then deletes a successful box unless
`keep_sandbox` is set (`util.py:83-92`). Keep is `!success` at every close point now,
and tests cover both a removed successful box and a kept failed one.

Merge hygiene: `a5e10c98` also carries two admin-panel files from a concurrent
writer's unstaged work in the shared worktree — `status-colour-baseline.json`
(258 → 256) and `ContestTasksSection.tsx` (warning → muted). They were staged between
this session's status check and its merge, so they entered the merge commit. The
backend tree is byte-identical to lane tip `337aa987`; removing the panel files would
require rewriting a shared merge, so they are recorded here and left untouched.

Merged gate: **161 targets, 982 passed, 0 failed, 2 ignored**; fmt and clippy clean,
and the two ignored tests are the same `TZ=Asia/Bangkok` child probes.

### S-5e3b: the worker computes, the binary still has to carry it

The lane is four commits (`371c8ac4`, `e673ed69`, `ef611a01`, `a9a97851`), merged as
`187b4cf7`; its own gate was **35 passed**, `cargo metadata --locked` exit 0, and the
one-line `cms-svc` lockfile edge is the only lock change. `Runner` reads a raw body
through the grading codec, builds the task type from its parameters, runs the typed
phase over the shared `FsCache`, and writes the result back; `execute_job_group`
returns the same ordered `jobs` envelope, stamps the shard, writes the tombstone
marker as one unsuccessful job, and raises the reference's busy sentence or
`Worker failed: …` for a group refusal. `JobError::Work` carries every non-tombstone
task refusal.

Two review defects shaped it. The lockfile was restored to the base to keep the lane
worker-only, which left `cargo metadata --locked` failing; the required `cms-svc`
entry is restored and verified. `Runner` also resolved the language before the task
type decided whether it needed one, which would refuse an `OutputOnly` job that never
reads a language and an answer-only `BatchAndOutput` job; lookup is deferred, and the
unknown-name sentence is reported only when a phase returns `NoLanguage`. Tests cover
the Batch refusal plus the three output-only paths.

Not carried: the binary, host binding, environment parsing and `precache_files`. The
merge was made with `--no-commit` and the staged set inspected before committing; it
contains only `backend/Cargo.lock` and `backend/cms-worker`, so this merge did not
absorb the concurrent panel files left dirty in the shared worktree.

Merged gate: **161 targets, 1004 passed, 0 failed, 2 ignored**; fmt, clippy and
`cargo metadata --locked` all clean, and the two ignored tests are the same
`TZ=Asia/Bangkok` child probes.

### S-5e3c: the worker binary exists; the container still runs Python

The lane is four commits (`1b009b6d`, `e4468f41`, `995ea163`, `5e6c4214`), merged as
`36b9595b`; its own gate was **46 passed**, with fmt, clippy, `cargo build` and
`cargo metadata --locked` clean. `Settings` reads the worker's environment, names
every refused variable, and builds `CompilationLimits`/`TrustedLimits` in bytes and
seconds. The binary composes `Runtime`, `FsCache`, `Runner` and `Worker`, binds the
five task types, attaches `quit`, reports the bound address and maps a fatal stop to
a failure exit. The smoke test sends `echo` and `quit` over the real CRLF RPC framing.

One path defect was caught before merge: the Python shared cacher stores files under
`cache_dir/fs-cache-shared` (`filecacher.py:534,597`), not `cache_dir`. The binary
opens `Settings::shared_file_dir()`, and the join is tested.

Deployment is not switched. `docker-compose.yml` still starts `cmsWorker`, and the
worker environment does not pass `RPC_SECRET`, which the Rust binary requires; the
compose and config-sync change plus `precache_files` remain open.

Merged gate: **162 targets, 1015 passed, 0 failed, 2 ignored**; fmt, clippy, build
and `cargo metadata --locked` clean, with the same two `TZ=Asia/Bangkok` child probes.

### S-5e3d: precache files through the real FileCacher

The lane is three commits (`3f65470f`, `c759ed17`, `f996a28c`), merged as `1c54022d`;
its own gate was **53 passed**, with fmt, clippy and `cargo metadata --locked` clean.
`precache_files` takes the shared lock, loads the contest list and `enumerate_files`
with `skip_submissions` and `skip_user_tests`, rolls the transaction back, and fetches
each digest through `cms_db::FileCache` with `Backend::database` into
`cache_dir/fs-cache-shared`. A missing file is passed over; a malformed or missing
`contest_id` is refused by name; a worker without `DATABASE_URL` still serves jobs and
refuses precache rather than panicking.

The first brief routed the walk through `cms_grading::precache` over `FsCache`; that
would have fetched nothing, because `FsCache` only reads the shared directory. The
lane uses the database-backed `FileCache` and records that the synchronous walk stays
unused on this path. The contest digest set is materialised in memory, matching the
reference; `PRECACHE_BATCH` does not bound it.

Deployment remains open: the container still starts `cmsWorker`, and the worker
environment passes neither `RPC_SECRET` nor `DATABASE_URL`.

Merged gate: **162 targets, 1022 passed, 0 failed, 2 ignored**; fmt, clippy and
`cargo metadata --locked` clean, with the same two `TZ=Asia/Bangkok` child probes.

### S-5e3e: the worker deployment definition runs Rust

The lane is four commits (`af254c2e`, `71b8a4c4`, `aec8c548`, `1eca0be3`), merged as
`6bdfee9c`. The image builds and ships `cms-worker`; compose runs it instead of
`cmsWorker` and healthchecks `pgrep -x cms-worker`. The container receives
`RPC_SECRET`, `DATABASE_URL`, its published `WORKER_PORT`, the sandbox limits and one
`MAX_FILE_SIZE` assignment. Config sync renders the six sandbox limits from the
lowercase `[sandbox]` keys, strips TOML digit separators, and replaces an older
`[worker] MAX_FILE_SIZE` rather than appending a duplicate.

The variable-coverage gate grew an explicit section-scoped mapping for those six
derived env names; a missing source key fails its own warning, tested in
`tests/test_var_coverage.sh`. The gate remains red only for the seven warnings that
were already present at the lane's base: `CMS_SERVICES`, `DAST_AT_UTC`,
`DAST_MINUTES`, `DAST_TARGET`, `LOG_DIR`, `LOG_SERVICE_ADDR` and
`RESOURCE_SERVICE_ADDR`. This slice did not repair or suppress them.

No container was started or restarted. A full image build and live worker RPC,
database, isolate and healthcheck exercise remain unverified.

Merged gate: **162 targets, 1022 passed, 0 failed, 2 ignored**; fmt, clippy and
`cargo metadata --locked` clean. Config-sync tests 95/0, variable-coverage tests 7/0,
image pins 77/0, compose config 0 and shell syntax 0.

### S-5e3f: the worker honours KEEP_SANDBOX

`Runtime` gained a `keep_sandbox` flag and a `with_keep_sandbox` builder, so every
existing constructor stayed unchanged. Compilation, evaluation, two-step,
communication and checker closes now keep a box when the worker asks or the attempt
failed; `archive_sandbox` remains a separate decision, so a successful kept box can
still file its digest. The checker box keeps when there is no verdict even without
the worker flag, as the reference does. `KEEP_SANDBOX` accepts true/false and 1/0 in
any case and refuses anything else by variable name.

Seven commits, merged as `8233f065`. Lane gate: **64 targets, 335 passed, 0 failed**
(`cms-grading` 280, `cms-worker` 55), fmt, clippy and `cargo metadata --locked`
clean, zero removed comments. The negative control changed the compilation expression
back to `!success` and failed `a_successful_compilation_is_kept_only_when_the_worker_asks`
at `backend/cms-grading/tests/tasktypes.rs:175`.

Merged gate: **162 targets, 1028 passed, 0 failed, 2 ignored**; fmt, clippy and
`cargo metadata --locked` clean.

### S-6a: an outbound RPC client

`cms-svc::Client` is the caller the server half lacked: one persistent socket, one
blocking call at a time, a process-unique correlation id, and the secret sent only
when configured. A non-null `__error` becomes `Refused` with the service's text; a
response naming another request becomes `MismatchedId`; connect, write, read, frame
and decode failures stay distinct. The owning service keeps reconnection policy, so
there is no hidden retry loop. Tests run against a real `cms-svc::Host` and scripted
listeners, including wrong ids, non-string errors, unknown methods and secret
redaction.

Two commits, merged as `9a4a4cfd`. Lane gate: **13 targets, 154 passed, 0 failed**
for `cms-svc`, fmt, clippy and `cargo metadata --locked` clean, zero removed
comments.

Merged gate: **163 targets, 1046 passed, 0 failed, 2 ignored**.

### S-6b: the Checker runs Rust

`cms-svc::all_services` exposes every `CMS_SERVICES` row without the local-host
filter. `Checker::check_once` dials each peer, echoes `Coord timestamp`, keeps a
working client for the next round, and records a dead or mis-shapen peer as that
peer's failure. `cms-checker` binds `CHECKER_SERVICE_PORT` on `0.0.0.0`, serves
`echo`/`quit`, runs a round immediately and every 90 seconds stop-aware, and refuses
a missing or malformed `CMS_SERVICES` by name. Compose runs the binary with
`CMS_SERVICES` and `RPC_SECRET`; a configurable checker port reaches both the process
and the published target. The image builds and ships the binary.

Four commits, merged as `901a35af`. Lane gate: **16 targets, 177 passed, 0 failed**;
fmt, clippy and `cargo metadata --locked` clean. Checker compose 8/0, render-expose
11/0, config-sync 95/0, zero removed comments.

Merged gate: **166 targets, 1069 passed, 0 failed, 2 ignored**; fmt, clippy and
`cargo metadata --locked` clean.

### S-6c1: the score documents are pinned

`Scored::details_json` and `Scored::public_details_json` serialize the stored
documents with exactly the keys the reference writes. Sum rows carry idx, outcome,
text, time and memory; Group testcase rows additionally carry time_limit,
time_limit_was_exceeded and both feedback flags; a hidden row is only `{"idx": …}`,
and a public subtask with any hidden testcase carries no score fields. Absent
measurements serialize as null. Six exact-document tests cover both score types,
both public/private shapes and the empty arrays.

Merged as `aaa394d5`. Lane gate: **58 targets, 286 passed, 0 failed**, fmt, clippy
and `cargo metadata --locked` clean; one removed-comment scan was zero.

Merged gate: **167 targets, 1075 passed, 0 failed, 2 ignored**.

### S-6c2: the scoring core

`DatasetRecord` now carries `score_type` and the raw `score_type_parameters` text;
`DATASET_BY_ID` and the judgeable-dataset query both project them. A pure
`cms_grading::scoring::score()` takes one result, its task, evaluations and
testcases, builds the score-type input, computes the score, and returns the
`ScoreRow` with the pinned detail documents, task precision and scored timestamp.
A missing, unknown or malformed evaluation is refused by testcase; an unevaluated
result is scored zero without consulting its evaluations, matching the score types'
early return.

Three commits, merged as `9cf76eff`. Lane gate: **116 targets, 679 passed, 0 failed,
2 ignored** across `cms-db` and `cms-grading`; fmt, clippy and
`cargo metadata --locked` clean, zero removed comments.

Merged gate: **170 targets, 1088 passed, 0 failed, 2 ignored**.

### S-6c3: the scoring database boundary

`cms_db::scoring_candidates` reproduces the reference queue filter — judgeable
dataset, five score columns not all set, and either a failed compilation or an
evaluation outcome — ordered by submission timestamp and id. `read_result_bundle`
gathers the task, dataset, result, evaluations and testcases in the caller's
transaction. `write_score` executes the existing score upsert with every column
bound and replaces an existing row.

Two commits, merged as `1eb276c0`. Lane gate: **57 targets, 384 passed, 0 failed,
2 ignored** in `cms-db`; the three scoring live tests ran against PostgreSQL and
passed. fmt, clippy and `cargo metadata --locked` clean; zero removed comments.

Merged gate: **172 targets, 1091 passed, 0 failed, 2 ignored**.









