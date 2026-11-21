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

## Report

Evidence table per criterion (command | exit code | count), then what landed as a SHA, what is
blocked (named), what is next.
