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
   for migration in ranking_tables ranking_tables_rls ranking_notify \
                    ranking_console_users ranking_console_users_rls; do
     docker compose exec -T database psql -U cmsuser -d "${POSTGRES_DB:-cmsdb}" \
       -f - < "admin-panel/prisma/migrations/2026100915${migration:0:0}000_${migration}/migration.sql"
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
rollback path need it. To go back, restore the compose command and the Python configuration mounts
for `ranking-web-server`:

```yaml
    command: ["cmsRankingWebServer"]
```

and redeploy the stack. The tables keep the pushed data, so a rollback loses nothing; the console
accounts and the appearance row stay in the database for the next attempt.

## 6. Known gaps at the time of writing

- **The panel still renders its old ranking cards.** `RankingClient` polls `api/ranking/snapshot`,
  which needs five endpoints against the old Python service that the Rust service does not
  implement. Its connection card and scoreboard cannot work; the logo card still does, and must be
  kept when the rest is removed. See the plan, Slice 6.
- **The rehearsal has not been run against a stack by the author of the cutover.** The script exists,
  is syntax-checked, and its steps are listed above; its result belongs in the release notes.
- **`cmsRWSHelper` was removed** with the HTTP push path: manual pushes now mean writing the
  projection tables or letting the proxy do it.
- **`cms-ranking-data` holds only the logo.** The JSON store it was created for is gone.

