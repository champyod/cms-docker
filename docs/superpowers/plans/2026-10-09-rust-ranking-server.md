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

- [ ] Add the Prisma models for the pushed store and the control tables named in the spec section 4.2, with indexes on the lookups the service performs.
- [ ] Add the migration and the RLS enable/force pair generated by the repository script; update the backup table catalog test so the new models are accounted for.
- [ ] Add the permission keys for the control surfaces (ranking:appearance, ranking:override, ranking:access) to the registry and to the seeded group that already holds ranking:read; update the permission count and group tests.
- **Verify:** scripts/__generate_rls_sql.sh --check passes with the new table count; panel tsc and vitest green; no existing test weakened.
- **Commit:** feat(prisma): add the ranking tables and keys

### Slice 3: Read path and public surface

- [ ] Implement the sqlx queries for each entity kind and the score assembly that mirrors src/cmsranking/Scoring.py.
- [ ] Implement the public routes with the same shapes as today: /, /history, /scores, /config, /logo, and the full editable credit list on /credits.
- [ ] Do not implement the Basic-authenticated CRUD routes: the push path is retired with the file store, so the service is a reader of the pushed tables.
- [ ] Patch the vendored page only as far as the new /config fields require (CSS custom properties for the theme, title/subtitle/columns from PublicConfig).
- **Verify:** the parity fixtures pass field by field; the page renders in a browser against the fixture database.
- **Commit:** feat(ranking): serve the scoreboard from postgres

### Slice 4: Live events

- [ ] Implement /events with the same event names and ordering as the Python service, driven by the store plus a change channel.
- [ ] Propagate a control-table change (appearance or override) to connected browsers: LISTEN/NOTIFY with a bounded poll fallback.
- [ ] Test: an override written through the panel reaches an open event stream without a reload.
- **Verify:** event fixtures match; the propagation test passes against a real database in the test container.
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
