# S-4 — retire `src/cmsranking` (delete, not port)

`../PLAN.md` §3. 2,441 Python lines that **nothing ships**. This is the cheapest real slice in the
plan and it is a deletion, so it is verified by absence rather than by new assertions.

## Why this is a deletion and not a port

Measured on this lane's base `1fd7f8cc`, three independent ways:

1. **What ships is Rust.** `Dockerfile:201` — `COPY --from=ranking-build … /build/target/release/cms-ranking /home/cmsuser/cms/bin/cms-ranking`. The image never contains the Python module.
2. **No service runs it.** `grep -rn 'cmsranking\|cmsRankingWebServer' docker-compose*.yml Makefile` returns nothing, while the ranking container's `command: ["cms-ranking"]` is the Rust binary.
3. **Only three importers are left**, and two of them are packaging/coverage:
   - `src/setup.py:62` — package-data for `cmsranking/static/*`
   - `src/cmstestsuite/coverage.py:39` — names it in the coverage source list
   - `src/cmstestsuite/unit_tests/ranking_credits_test.py` — the only real consumer

And the coverage already exists in Rust: `ranking-web/tests/fixtures/parity/endpoints.json` is a
route-by-route spec **derived from these exact Python handlers** (`RankingWebServer.py`'s
`RoutingHandler`, `StoreHandler`, `SubListHandler`, `HistoryHandler`, `ScoreHandler`, `ImageHandler`,
`RootHandler`, `PublicConfigHandler`, `CreditsHandler`, and `Config.PublicConfig`), and
`ranking-web/tests/surface.rs` asserts the rendering rules (`/config` keys, the `ranking-credits` div,
`credits-sample.json`).

## The one thing that would make this wrong

`ranking_credits_test.py` is 254 lines and asserts more than rendering: the served `/credits` JSON's
`surface`, `PublicConfig` handling, and `RoutingHandler`'s routing table. Before deleting, **check
each assertion it makes against `ranking-web`'s Rust tests** and report a table: assertion | already
covered in ranking-web (which test) | NOT covered. Do not delete the file while an assertion in it has
no Rust counterpart — port that assertion into `ranking-web/tests/` first, in the same lane, and say
which test it became.

Deleting a test whose property is covered is correct. Deleting one whose property is not covered is
the coverage loss this slice must not cause.

## Acceptance criteria

1. `git rm -r src/cmsranking` and the three importer edits (`setup.py`, `coverage.py`, and the test —
   the last one only after its assertions have a Rust home, per above).
2. The coverage table from the section above, in the handback, one row per assertion.
3. `src/` still imports cleanly: `python3 -c "import compileall,sys; sys.exit(0 if compileall.compile_dir('src', quiet=1) else 1)"` exits 0, and nothing in `src/` mentions `cmsranking` except the parity fixture's provenance note (which is history and must stay).
4. `docker build --target core .` or the fastest available image build still succeeds — the Dockerfile
   must not be edited, and it must not have been referring to the deleted tree except through the
   Rust binary.
5. `ranking-web`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` all
   exit 0 (if you touched it).
6. Any Rust test you add to replace an assertion is **proved to fail** by inverting the expectation
   once, and passing after. Paste both.

## Out of scope

- Do not edit `admin-panel/**`, `docs/DESIGN*.md`, other lanes, `ranking-web/src/**` beyond what a
  ported assertion needs.
- Do not touch `Dockerfile`, `docker-compose*.yml`, or the `cms-ranking` binary.
- Do not delete `ranking-web/tests/fixtures/parity/**` — its `PROVENANCE.md` is the record that the
  Python handlers were the source.

## Landing record

- **The source offer comes from `credits.json`, not from a constant** (Tier B). The Python handler
  took `source_url` from `cms_ranking.toml` (`src/cmsranking/Config.py:41-51`) and the retired test
  asserted a fork could point the offer at its own repository; the Rust `public_config` served one
  compiled-in URL, so a fork could not, and `/config` and `/credits` carried two spellings of the
  same repository. `/config` now reads `project.url` from the file `/credits` serves, and falls back
  to the constant only when that file cannot supply it. Rejected: a `CMS_SOURCE_URL` environment
  variable — it is how the contest and admin pages read it (`src/cms/conf.py:77`), but the ranking
  container is never passed it (`docker-compose.yml:658-673`) and this brief forbids editing
  compose, so the knob would be unreachable in the image this lane ships.
- **The entry point and the units that ran it go with the package** (Tier B).
  `src/scripts/cmsRankingWebServer` is installed into the image's `bin/` by `src/setup.py:130` and
  does nothing but import `cmsranking`; both `config/systemd/cms-ranking.service` copies exec that
  script. Leaving them behind would ship a command that imports nothing, so they are deleted with
  the package and `src/install.py:77-81` loses the unit from its install list.
- **Blocked, not fixed in this lane:** `admin-panel/scripts/generate-icons.mts:128-130` still writes
  `src/cmsranking/static/img/{favicon.ico,logo.png}` and `src/cmsranking/images/logo.svg`, and CI's
  `bun run icons:check` (`.github/workflows/ci.yml:523`) fails once those commits are gone. The fix
  is three lines in an `admin-panel/**` file this lane may not edit.
- The rest of the `cmsranking` mentions in prose (`src/docs/Running CMS.rst:127`,
  `src/docs/Troubleshooting.rst:45,49`, `src/docs/Configuring a contest.rst:109`, `CLAUDE.md:1042`,
  `docs/RANKING-RUST-CUTOVER.md`) describe the retired service and are left for a docs pass.

## Report

Evidence table per criterion (command | exit code | count), then what landed as a SHA, what is
blocked (named), what is next.

---

## Parent's verification, and one correction to itself

Checked by the parent, not taken from the handback:

| Check | Result |
|---|---|
| Order of work | tests ported to Rust **first** (`0f50c8df`), then `git rm -r src/cmsranking` (`17dab504`) — correct order, so no assertion was deleted with its subject |
| Deletion is complete | `grep -rn cmsranking src/` → **0 lines**; every real module compiles (**0 syntax errors**); `ranking-web/tests/fixtures/parity` untouched |
| `Dockerfile` | `git diff <base>..HEAD -- Dockerfile` empty, `grep -c cmsranking Dockerfile` → **0**; `:201` still copies the Rust `cms-ranking` |
| Gates | `cargo fmt --check` 0 · `cargo clippy --all-targets -- -D warnings` 0, 0 errors · `cargo test` 0 — 25 targets, 0 failed |
| The ported tests bite | breaking `public_config.rs:42`'s fallback makes `an_unusable_credits_file_leaves_the_shipped_offer` **FAIL at src/public_config.rs:179**; restored → 7/7 pass |

**The parent was wrong once and is recording it.** A first negative control ran `cargo test --test
surface`, saw 33 pass with the licence fallback broken, and concluded the branch was untested. It is
tested — in the **lib** unit tests, which `--test surface` does not run. Re-run with `--lib`, the same
break fails `an_unusable_credits_file_leaves_the_shipped_offer` exactly as it should. The lesson is the
scope of the gate, not the child's work: a negative control is only evidence about the tests the
command actually runs.

**Criterion 3 was mis-specified by the parent.** `src/cmstestsuite/code/compile-fail.py` is a
*deliberate* syntax-error grading fixture (referenced by `src/cmstestsuite/Tests.py:188`), so a bare
`compileall` over `src/` can never exit 0 — it fails identically on the base commit. The property that
was wanted is "every real module still compiles", which holds: 394 files, 0 failed.

**Two things are not green, and they are not this slice's to fix:**

1. **CI `icons:check` will fail.** `admin-panel/scripts/generate-icons.mts:128-130` still lists
   `src/cmsranking/static/img/favicon.ico`, `…/logo.png` and `src/cmsranking/images/logo.svg`, and
   `.github/workflows/ci.yml:523` runs `bun run icons:check` unconditionally; a missing input reads as
   drift. The fix is to delete those three entries — `admin-panel/**` belongs to the frontend session.
2. **Pre-existing reds in `credits_test.py`** (3): the ranking surface's `first_party` lacks the 15
   `Perspectives.*` assets `Ranking.html:7-43` loads, plus panel deps `highlight.js`/`redis`, and
   `test_credited_paths_exist` needs `node_modules`, absent here. Reported with their lines, not
   repaired.
