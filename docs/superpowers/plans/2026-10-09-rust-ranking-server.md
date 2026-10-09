# Rust Ranking Web Server — Implementation Plan

> **For agentic workers:** the spec is approved before any code; each slice lands, verifies and is committed on its own. Never open the next slice before the previous one is green.

**Goal:** replace the Python ranking web server with a Rust service whose data lives in PostgreSQL, whose public surface and event stream match today's output, and whose appearance, manual overrides and login are controlled from the Next.js admin panel.

**Architecture:** one Rust crate (tools/cms-ranking) reading and writing the panel's Prisma schema over sqlx with the application role, so RLS stays binding; the Next.js panel remains the only editor of the control tables; ProxyService writes the pushed ranking rows directly, retiring the cms-ranking-data JSON store.

**Tech stack:** Rust (axum, tokio, sqlx, serde, chrono, thiserror, bcrypt, tower-http), PostgreSQL 16 with RLS, Next.js 16 / React 19 / Prisma 6 / Bun / vitest, Python CMS (SQLAlchemy + gevent) for the pusher.

**Spec:** docs/superpowers/specs/2026-10-09-rust-ranking-server-design.md

## Global constraints

- Files at most 250 lines; functions at most about 30 lines (project rule, stricter than the global 40).
- Zero type suppression: no unwrap on fallible I/O paths, no ignored Results, no any in TypeScript.
- Comments explain why, never what; no journal, phase or status markers in code.
- Conventional Commits, subject at most about 50 characters, imperative, no trailers, no Co-Authored-By.
- Stage by explicit path only; never git add . ; never touch the 19 uncommitted files in cms-docker-major.
- Panel code follows cms-docker-ranking/CLAUDE.md: verifyApiPermission before every route body, ensurePermission first line of every protected action, revalidatePath after every mutation, no hardcoded locale, dictionary keys in both en.json and th.json.
- No migration is applied without the RLS enable/force pair and the backup catalog test update.
- Every new permission key is added to the registry, to at least one seeded group, and to the tests that count keys and groups.
- No paid dependency anywhere; every Rust crate chosen is already vetted in docs/backend-migration/ARCHITECTURE.md section 6.
- Performance is design intent only: no benchmark gate is added and no speed figure is published.

## Verification commands

    cd tools/cms-ranking   && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
    cd admin-panel         && bunx tsc --noEmit && bun run test && bun run lint
    bash scripts/__generate_rls_sql.sh --check
    make test              (shell and compose suites)
    docker compose config  (compose validity, when the compose file is touched)

---

### Slice 0: Parity baseline before any code

- [x] Derive the wire shapes and the endpoint contract from source (the src/cmsranking entity classes, the RankingWebServer.py handlers and dispatch mounts, src/cmscommon/eventsource.py, Scoring.py) into tools/cms-ranking/tests/fixtures/parity/{entities,endpoints,events,seed}.json.
- [x] Ship capture.sh, which reproduces the golden bytes on a host where the Python service is running. Docker is absent in the authoring environment, so no capture has been taken and every derived expectation is labelled as derived.
- [ ] Run capture.sh on the target host before Slice 3 and commit its captured/ output.
- **Verify:** every JSON fixture parses, capture.sh passes bash -n, and the README states what is derived and what is captured.
- **Commit:** test(ranking): add the parity baseline

### Slice 1: Scaffold the crate and its gates

- [x] Created tools/cms-ranking (Cargo.toml, Cargo.lock, src/{main,lib,config,db,http}.rs, tests/fail_closed.rs) on edition 2021, depending only on what the code uses: axum, serde, sqlx (postgres, runtime-tokio), thiserror, tokio.
- [x] No .cargo/config.toml musl pin, unlike tools/cms-tui: the ranking service ships inside the image rather than as a checked-in standalone binary, so a musl target would drag a C toolchain into the build for no gain.
- [x] Added the rust_ranking paths filter and the rust-ranking job (fmt, clippy -D warnings, test) to .github/workflows/ci.yml.
- [x] Added the ranking-build stage to the Dockerfile and copied the binary to /home/cmsuser/cms/bin/cms-ranking, so the runtime layer carries no compiler next to the submission tooling.
- [x] /healthz answers 503 until a real SELECT 1 succeeds, and the fallback refuses every unimplemented route, so a misconfigured deployment shows nothing instead of an empty scoreboard.
- **Verify:** fmt clean, clippy -D warnings silent, 6 tests green locally; ci.yml parses under js-yaml. docker compose config could not run here: no Docker daemon in the authoring environment.
- **Commit:** feat(ranking): scaffold the rust ranking server

### Slice 2: The ranking tables

- [x] Added eight models: the six ranking_* projection tables the proxy pushes, plus ranking_settings (one row, id 1) and ranking_overrides.
- [x] Typed columns rather than the spec's earlier jsonb sketch: /scores and /history aggregate over user, task and time, so those must be indexable columns. The spec's section 4.2 was corrected to match.
- [x] No foreign keys on the projection tables: the pusher sends kinds in dependency order and the Python store dropped a dangling reference rather than failing the write, so a constraint would turn a push-order slip into a lost submission.
- [x] Added the CreateTable migration and the RLS enable/force migration generated by scripts/__generate_rls_sql.sh; the gate now reports 44 tables.
- [x] Classified the tables in the backup catalog: the six projection tables join MODELS_OUTSIDE_CATALOG (derived from data a restore already carries), while ranking_settings and ranking_overrides enter BACKUP_TABLES (operator decisions that exist nowhere else).
- [ ] The three permission keys moved to Slice 6: permission-coverage.test.ts fails any registry key no code enforces, so a key cannot land before the surface that gates on it.
- **Verify:** scripts/__generate_rls_sql.sh --check reports 44 tables; prisma validate accepts the schema; the catalog suite passes (41 tests).
- **Commit:** feat(prisma): add the ranking tables

### Slice 3: Read path and public surface

- [x] Ported cmsranking.Scoring into src/scoring.rs and verified it against the shipping Python scorer: the fixture values are executed output, not a reading.
- [x] src/store.rs reads the projection over sqlx; /scores, /history and /config serve it. A missing database, an unreachable one and an unknown score mode all answer 503, because an empty board during a contest is worse than an error.
- [x] Three database-backed tests are ignored without a live PostgreSQL, so the CI job now runs a postgres service, applies the CreateTable migration and passes --include-ignored. An ignored test nobody runs is a claim, not a check.
- [x] /, /logo and /credits serve: the vendored page with the panel title and theme injected server-side, so the vendored assets stay unpatched; the logo resolved panel-then-host-then-static; the credits JSON keeping the project and license names the Python route used.
- [x] A theme value that could close its CSS declaration is dropped instead of injected, and a missing credits file refuses rather than serving an empty licence offer.
- [ ] The HTTP-level parity gate needs capture.sh run where the Python service is up.
- **Verify:** scoring parity green (2 tests), surface tests green (7), config tests green (6), clippy silent, the ignored database tests compile. Full HTTP parity still pending.
- **Commit:** feat(ranking): serve scores and history from postgres

### Slice 4: Live events

- [x] /events streams the Python service's vocabulary: the entity kind as the event name, "<operation> <key>" as the data, a hexadecimal microsecond id, and a control event that tells the page to refetch /config.
- [x] Changes are published by database triggers on all eight tables (migration 20261009160000_ranking_notify) rather than by the writer, so the notification sits beside the row it describes.
- [x] A reconnecting client replays from a 100-event cache or gets event:reinit when the gap is wider, and a listener that loses its connection publishes a reinit rather than pretending it missed nothing.
- [ ] Open: the panel-side override test, which needs Slice 6 to be able to write an override.
- **Verify:** six feed tests green locally (framing, replay, uncovered gap, subscriber delivery, entity mapping); the trigger has an ignored round-trip test that CI runs against postgres after applying all three migrations.
- **Commit:** feat(ranking): stream live ranking events

### Slice 5: The two authentication planes

- [ ] Machine plane: constant-time comparison of the provisioned token for the CRUD routes, failing closed when unset.
- [ ] Human plane: verify admins.authentication with bcrypt (bcrypt:<hash> prefix, plaintext: prefix for seeded accounts), the same format the panel writes.
- [ ] Generate the ranking key subset from admin-panel/src/lib/permission-registry.ts into the crate, with a CI gate that fails on drift; resolve group grants plus per-admin overrides with deny-wins and all:all expansion for that subset.
- [ ] Session cookie, adaptive CAPTCHA against the provider siteverify endpoint using the existing CAPTCHA_* keys, 5-failure lockout, 429 with Retry-After.
- **Verify:** unit tests for the resolver and the lockout; a drift test that fails when the TypeScript registry gains a ranking key the crate does not know.
- **Commit:** feat(ranking): protect the ranking console

### Slice 6: Panel control surfaces

- [ ] Add the appearance editor (all six approved groups) as a permissioned, audited server action plus API route and a page section under the ranking area.
- [ ] Add the override editor: list, add, end. Every mutation records actor, reason and timestamp; no row is hard-deleted.
- [ ] Add the login toggle (public or login-required) and the lockout view with an unblock action; CAPTCHA keys stay in config.toml and are not editable here.
- [ ] Render the compact credits text in the scoreboard footer and edit the full credit list on /credits, with the non-removable source-offer line in both.
- [ ] Dictionary keys in en.json and th.json for every new label.
- **Verify:** tsc, vitest, and a manual pass that the panel preview matches the served page; permission tests cover the new keys.
- **Commit:** feat(panel): control ranking appearance and overrides

### Slice 7: Move the push path

- [ ] Rewrite ProxyService's send path to write the ranking rows with parameterised SQL on the application connection, keeping the retry behaviour and the "already sent" bookkeeping.
- [ ] Retire the HTTP pusher at once: remove the Basic-authenticated CRUD routes, drop cmsRWSHelper from the documented workflow, and stop the panel storing ranking Basic credentials.
- [ ] Stop writing the JSON store; document the volume as legacy in the compose file and the service guide.
- **Verify:** a submission scored in a rehearsal produces the same rows the PUT path produced, checked by a fixture comparison; python unit tests still pass.
- **Commit:** feat(proxy): write ranking rows to postgres

### Slice 8: Cutover

- [ ] Change the ranking-web-server command to the Rust binary; keep container name, port, healthcheck and labels.
- [ ] Amend docs/decisions/ranking-logo-storage.md rather than contradicting it, and update docs/QUICKREF.md, docs/SERVICE_GUIDE.md, docs/ACCESS-CONFIGURATION.md and docs/DB-ROTATION.md pass criteria.
- [ ] Remove cmsRankingWebServer from the runtime path and record the retirement in the changelog; leave the Python source in the tree until the parity gate has run in production once.
- **Verify:** docker compose config; the service answers all public routes on the fixture database; docs links resolve.
- **Commit:** feat(deploy): cut the ranking server over to rust

### Slice 9: Acceptance

- [ ] End-to-end rehearsal per REQ-F10: contest setup, submission, judging, ranking, with an operator-visible check of the scoreboard.
- [ ] Rotation rehearsal per docs/DB-ROTATION.md with ranking in the pass criteria.
- [ ] Record the result, including anything that failed, in the spec as an acceptance note.
- **Commit:** docs(ranking): record the cutover acceptance
