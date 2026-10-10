# Ranking server: the Rust cutover runbook

The ranking scoreboard is served by `cms-ranking`, a Rust binary in `tools/cms-ranking`, reading the
projection tables the proxy writes. This runbook is what an operator runs before, during and after
the switch, and what to do if it goes wrong. The design and its decisions are in
[`superpowers/specs/2026-10-09-rust-ranking-server-design.md`](superpowers/specs/2026-10-09-rust-ranking-server-design.md).

## 1. What changes

| Item | Before | After |
| :--- | :--- | :--- |
| Service command | `cmsRankingWebServer` (Python) | `cms-ranking` (Rust) |
| Data | JSON files in `cms-ranking-data` | the `ranking_*` tables in PostgreSQL |
| Push path | ProxyService PUTs to the service over HTTP | ProxyService upserts the tables |
| Console login | HTTP Basic from `cms_ranking.toml` | `ranking_console_users`, own signed cookie |
| Failure counters | none | the stack Redis, under `cms:ranking:login:` |

The container name, port, profile, labels and published mapping are unchanged, so nothing outside
the service needs to move.

## 2. Pre-flight

1. **Migrations.** The five ranking migrations must be applied, in order:

   ```bash
   for migration in \
       20261009150000_ranking_tables \
       20261009150100_ranking_tables_rls \
       20261009160000_ranking_notify \
       20261009170000_ranking_console_users \
       20261009170100_ranking_console_users_rls; do
     docker compose exec -T database psql -U cmsuser -d "${POSTGRES_DB:-cmsdb}" \
       -f - < "admin-panel/prisma/migrations/${migration}/migration.sql"
   done
   ```

   In practice `make prisma-sync` applies the history; the check is that the gate agrees:
   `bash scripts/__generate_rls_sql.sh --check` reports every table covered.
2. **Counter store.** Redis must be reachable as `redis-rate-limit:6379` on the stack network. The
   compose service already points `RANKING_REDIS_URL` at it.
3. **Session secret.** `./cms config sync` generates `RANKING_SESSION_SECRET`. An empty value makes
   the console refuse every login rather than mint an unsigned one.
4. **The page on disk.** `RANKING_STATIC_DIR` (the vendored `cmsranking/static` in the image) and
   `CMS_CREDITS_FILE` must exist; without them `/` and `/credits` refuse.
5. **A console account.** `ranking_console_users` needs at least one enabled row, or nobody can reach
   the console when the scoreboard is set to `protected`. Passwords use the panel format:
   `bcrypt:<hash>` or `plaintext:<value>`.

## 3. The switch

```bash
./cms config sync          # regenerates .env, including RANKING_SESSION_SECRET
./cms deploy admin         # or: make admin DEPLOYMENT_TYPE=img
```

## 4. Verification, in the order that fails fastest

| Step | Command | Expected |
| :--- | :--- | :--- |
| The service is up | `curl -fsS localhost:8890/healthz` | `200 {"status":"ok"}`; it is `503` until `SELECT 1` succeeds |
| It refuses what it cannot serve | `curl -o /dev/null -w "%{http_code}" localhost:8890/config` with the database stopped | `503`, never an empty board |
| The board matches the Python scorer | `RANKING_E2E_DATABASE_URL=... bash tools/cms-ranking/tests/e2e/ranking_e2e.sh` | every step prints `[PASS]` |
| Live events | the same script | a write reaches an open stream |
| Protected mode | set `access_mode = protected`, open `/` anonymously | a redirect to `/login` |
| Sign-in | sign in with a console account | the board opens; a wrong password sets no cookie |

The rehearsal script is the authority for the database-backed claims. Nothing else in the repository
exercises the served scoreboard against a live database.

## 5. Rollback

The Python command is **still installed** in the image on purpose: the parity capture and the
rollback path need it. To go back, restore the compose command and mount a ranking config for
`ranking-web-server`:

```yaml
    command: ["cmsRankingWebServer"]
```

The deployment no longer generates `config/cms_ranking.toml`, so a rollback must copy
`config/cms.ranking.sample.toml` to that path and mount it as `CMS_RANKING_CONFIG` before
redeploying. The tables keep the pushed data, so a rollback loses nothing; the console accounts and
the appearance row stay in the database for the next attempt.

## 6. Known gaps at the time of writing

- **The rehearsal still has not been run on a host by the author of the cutover.** This
  environment has neither docker nor psql, so the script is syntax-checked here and runs in CI —
  the `rust-ranking` job gives it a fresh Postgres and its own Redis, then drives the release
  binary. Its result against a real stack belongs in the release notes.
- **`cmsRWSHelper` was removed** with the HTTP push path: manual pushes now mean writing the
  projection tables or letting the proxy do it.
- **`cms-ranking-data` holds the logo and the contestant faces.** The JSON store the volume was
  created for is gone; faces live beside the logo as `avatars/<user>.<ext>` and are read per
  request, so replacing a file updates the board with no restart. Uploading one is an API call
  (`POST /api/ranking/avatars/<user>`, gated on `ranking:update`) — the panel has no face picker
  yet, while the logo still has its card on the board page.

### Closed since the first draft

- **The panel's old ranking cards are gone.** `RankingClient` and `api/ranking/snapshot` are no
  longer anywhere in the panel — the scoreboard is served by the ranking service itself — so the
  five endpoints they needed are not a gap. What survived is the logo card, and it now sits on the
  Ranking group's board page rather than a card that polled a retired endpoint.
- **The credit list is edited apart from the appearance.** The two were one form, so a field one
  page stopped posting would have written an empty list over the other; they now save separately.

## 7. Where to configure

Every knob has one home. The panel only reads what the stack already puts in front of it, so a
setting that is not registered in `config.toml` cannot reach the container at all —
`__check_spec_parity.sh`, `__check_var_coverage.sh` and `tests/test_proxy_body_size.sh` enforce
that three ways.

| What | Where | Reaches the service by |
| --- | --- | --- |
| Session secret, CAPTCHA keys, `RANKING_*` | `config.toml` `[admin]` | `./cms config sync` → `.env` → compose |
| Upload caps: `MAX_LOGO_UPLOAD_BYTES`, `MAX_AVATAR_UPLOAD_BYTES`, `MAX_STATEMENT_UPLOAD_BYTES`, `MAX_ATTACHMENT_UPLOAD_BYTES`, `MAX_TESTCASE_FILE_BYTES`, `MAX_TESTCASE_UPLOAD_BYTES` | `config.toml` `[admin]` | compose passes each one into the panel container |
| Ranking logo host path | `config.toml` `RANKING_LOGO_PATH` | `./cms config sync` copies it into `cms-ranking-data` (hot swap) |
| Appearance, credits list, overrides, console lockouts | **Ranking → appearance / credits / settings / lockouts** | written to `ranking_settings` and the override tables; the service re-reads them on the next request |
| Branding, per-service settings, display density | **System → appearance** | writes `config.toml` |
| Database and Redis the service reads | `docker-compose.yml` service env | — |

The panel's own `ranking/*` group is the only place the surface is edited:

- **board** — what the public scoreboard opens with, and the logo it carries;
- **settings** — manual overrides (hide, guest, pin, rename, score);
- **appearance** — title, subtitle, organisation, access mode, footer and credits text;
- **lockouts** — console lockouts and their release;
- **credits** — the credit list the scoreboard attributes its licences to.

`/infrastructure/ranking` still resolves: it is a redirect to `/ranking`, so old bookmarks and
chords keep working.


