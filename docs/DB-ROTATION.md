# Database creation and rotation

`./cms db create <name>` and `./cms db rename <old> <new>` create and rename a PostgreSQL database inside the running `cms-database` container. Both are supported, both are documented here for the first time, and neither appears in `./cms help` or `./cms db --help` because the Rust TUI does not implement them: `cms` intercepts the two verbs in a bash shim (`cms`) and delegates to `scripts/__db_admin.sh`, which is the single authority for the container-side SQL, the authorisation policy and the exit codes.

Read this document together with [`DB-MIGRATION-CUTOVER-RUNBOOK.md`](DB-MIGRATION-CUTOVER-RUNBOOK.md). That runbook owns schema, roles, RLS and the migration history; this one owns the database *name* and which profile points at it. Neither duplicates the other.

## Contents

1. [What the two verbs do](#1-what-the-two-verbs-do)
2. [Safety properties](#2-safety-properties)
3. [Authorisation and dry run](#3-authorisation-and-dry-run)
4. [Preconditions](#4-preconditions)
5. [Rotation: rename the live database](#5-rotation-rename-the-live-database)
6. [Provisioning: create a sibling database](#6-provisioning-create-a-sibling-database)
7. [Pass criteria](#7-pass-criteria)
8. [When a step fails](#8-when-a-step-fails)
9. [Known gaps](#9-known-gaps)

## 1. What the two verbs do

| Verb | Invocation | Effect |
|---|---|---|
| `create` | `./cms db create <name> [--dry-run]` | `CREATE DATABASE "<name>"` if it does not already exist. Idempotent: an existing database is reported and the command exits 0 without touching the server. |
| `rename` | `./cms db rename <old> <new> [--dry-run]` | Takes `<old>` out of service, drops the sessions attached to it, runs `ALTER DATABASE "<old>" RENAME TO "<new>"`, and re-opens the new name. |

`create` issues exactly one statement. It is not a provisioning command and it is not paired with a migration command.

`rename` runs four statements in order, each on its own because `ALTER DATABASE` cannot run inside a transaction block:

```
ALTER DATABASE "<old>" WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '<old>' AND pid <> pg_backend_pid();
ALTER DATABASE "<old>" RENAME TO "<new>";
ALTER DATABASE "<new>" WITH ALLOW_CONNECTIONS true;
```

Database names must match `^[a-z_][a-z0-9_]{0,50}$` — lower-case letters, digits and underscore, no leading digit, 51 characters maximum. The allowlist is stricter than the server because the name is interpolated into SQL and into a database URI. `template0`, `template1`, `postgres` and `all` are rejected: renaming onto any of them would break the cluster.

Neither verb appears in `./cms db --help`. The usage block is also not reachable with a clean exit through `./cms`: any malformed invocation prints it to stderr and exits 1. Read it directly instead:

```bash
bash scripts/__db_admin.sh --help
```

## 2. Safety properties

- **Neither verb deletes data.** `create` cannot overwrite an existing database — PostgreSQL has no `CREATE OR REPLACE DATABASE`, and the script checks existence before running. `rename` only moves a name; it does not touch rows, roles or schemas.
- **There is no drop verb.** `scripts/__db_admin.sh` does not implement `drop`. A drop cannot be undone and PostgreSQL has no `DROP DATABASE IF EXISTS`, so the capability is absent by design. Use `psql` directly if a drop is genuinely intended.
- **The authorisation gate is deliberately lighter than the destroy gate** that `db clean` / `db reset` use, which requires `CONFIRM_DB_DESTROY` and deletes every volume in the compose project. `CONFIRM_DB_ADMIN` guards a name change, not a deletion.
- **`rename` is not online-transparent.** It drops every session attached to the source database. No service is stopped, so the running connection pools are killed and error until the repoint in §5.3 and a redeploy. Treat the rename window as downtime.
- **A rename refuses to overwrite.** If the target name already exists the command exits 1 with `target database "<new>" already exists — refusing to rename onto it`.

## 3. Authorisation and dry run

Two independent controls, quoted from `scripts/__db_admin.sh`.

**`CONFIRM_DB_ADMIN=yes` — authorise non-interactively.** From the script header: *"an explicit non-interactive authorisation (CONFIRM_DB_ADMIN=yes) or the literal word `yes` typed at a terminal."* And from its own usage block: *"authorise non-interactively (scripts/CI). On a terminal you are otherwise asked to type `yes`."*

The policy, in full:

- `CONFIRM_DB_ADMIN=yes` set in the environment → proceed, after logging that authorisation was used.
- Not set, and stdin is not a terminal (CI, an agent, a pipeline) → **refused, exit 1**. The refusal prints the exact re-run command. There is no interactive fallback on a non-TTY.
- Not set, and stdin is a terminal → prompted `Type "yes" to run: <action> : `. Only the literal word `yes` proceeds. Anything else, including an empty line, prints `Aborted. The database was not modified.` and exits 1.

**`--dry-run` — print the SQL and change nothing.** From the usage block: *"print the exact SQL and exit 0 without touching docker."* The dry-run branch returns before the container is inspected, so a dry run works with the stack stopped and exits 0. It is not an authorisation bypass and does not consume `CONFIRM_DB_ADMIN`.

Dry-run is the correct first command for any production rename:

```bash
./cms db rename cmsdb cmsdb_archive --dry-run
./cms db create cmsdb_evaluate --dry-run
```

Two cases do not reach the prompt, so a refused confirmation cannot be the cause:

- `create` on a database that already exists reports it and returns 0 before the gate.
- `rename` validates that the source exists and the target does not before the gate.

**Exit codes** (`scripts/__db_admin.sh`, header): `0` = done, or dry run printed; `1` = refused or failed. `cms` propagates the script's exit code unchanged.

## 4. Preconditions

1. Run every command below from the repository root; `cms` resolves `scripts/__db_admin.sh` by a relative path.
2. `./cms doctor` passes and `git status` shows the tree you intend to run against.
3. `./cms config sync` has run, so `.env` carries the current `POSTGRES_*`. The script prefers an already-exported `POSTGRES_*`, then the generated `.env` / `.env.core`, and finally reads the credentials back out of the container itself, so no credential literal lives in the script and a missing `.env` does not break it.
4. The `cms-database` container is running (`make core`). The script refuses to proceed if it is missing or stopped, and names `make core` in the error.
5. **Take a backup first: `./cms backup`.** Confirm the archive exists under `backups/db/`. Every recovery path below is a restore from that archive. If the backup fails, stop.
6. Know which `[db_<profile>]` sections name the database you are about to change:
   ```bash
   grep -n 'POSTGRES_DB' config.toml
   ```
   Its output is the authoritative work list for the repoint in §5.3. `POSTGRES_DB` is per-profile, so a deployment with N profiles needs N repoints.
7. Schedule a window. `rename` drops live sessions; `create` leaves an empty database that is not usable until §6.4 runs.

## 5. Rotation: rename the live database

Use this when the live database must be preserved under a new name and a fresh one takes its place — an archive, a rebuild target, a hand-off to a rebuilt schema.

### 5.1 Rename

```bash
./cms db rename cmsdb cmsdb_archive
```

On a terminal, type `yes` when prompted. From a script or an agent:

```bash
CONFIRM_DB_ADMIN=yes ./cms db rename cmsdb cmsdb_archive
```

`<old>` is briefly out of service and its sessions are dropped. The rename is then complete and the new name accepts connections again.

### 5.2 Read the report

After a successful rename the script reports which `[db_<profile>]` sections in `config.toml` still point at the old name. Treat that as a prompt, not as a complete audit — re-run the grep from §4.6 yourself and work from its output. If `config.toml` is missing or unreadable the script says it cannot determine the list and tells you to find it by hand.

### 5.3 Repoint every profile — required

**`rename` does not update `.env` or `config.toml`. Neither does `create`.** From the script's usage block: *"rename takes `<old>` out of service on its own … renaming does NOT update .env or config.toml — repoint the db_`<profile>` POSTGRES_DB yourself, then run: ./cms config sync".*

Edit every `[db_<profile>]` section whose `POSTGRES_DB` still names the old database:

```toml
[db_default]
POSTGRES_DB = "cmsdb_archive"    # was "cmsdb"
```

A commented-out profile such as the `[db_staging]` block in `config.toml.example` is not active and needs no edit. The profile that `ACTIVE_DATABASE` in `[core]` selects is the one that matters for the running stack, but every profile that names the old database will be projected into `.env` the next time it is selected.

### 5.4 Resync and redeploy

```bash
./cms config sync
```

`__config_sync.sh` projects the active profile — `[core] ACTIVE_DATABASE`, default `default` — into the core namespace and writes the `POSTGRES_*` values into `.env`. It fails loudly if `ACTIVE_DATABASE` names a profile that has no `POSTGRES_*` keys, rather than leaving `.env` describing the previous database.

Then restart the stacks so they pick up the new `.env` — `config sync` rewrites files and restarts nothing:

```bash
./cms deploy core
./cms deploy all      # when every stack must be recreated against the new database
```

### 5.5 Provision the replacement

Continue with §6 to create the database that now carries the workload.

### 5.6 If the repoint is skipped

Services come back configured with a database name that no longer exists and fail **at connect time with a generic error**. The failure names neither the old name nor the rename as its cause, which is why the repoint is a required step rather than a convenience. Recover by completing §5.3 and §5.4 — no data is lost; the data is under the new name.

## 6. Provisioning: create a sibling database

Use this to add a second database alongside the live one — an evaluation copy, a rehearsal target, a rebuild destination.

### 6.1 Create

```bash
./cms db create cmsdb_evaluate
```

Idempotent: re-running it reports that the database exists and exits 0.

### 6.2 Give it a profile

Add a `[db_<profile>]` section to `config.toml`, seeded from the commented `[db_staging]` block in `config.toml.example`, with `POSTGRES_DB` set to the new name and the same credentials as `[db_default]`:

```toml
[db_evaluate]
POSTGRES_HOST = "database"
POSTGRES_PORT = 5432
POSTGRES_PORT_EXTERNAL = 5432
POSTGRES_DB = "cmsdb_evaluate"
POSTGRES_USER = "cmsuser"
POSTGRES_PASSWORD = ""
POSTGRES_BACKUP_PASSWORD = ""
POSTGRES_HOST_AUTH_METHOD = "md5"
```

Leave the secrets empty — `./cms config sync` generates them.

### 6.3 Select the profile

```bash
./cms db use evaluate
```

This rewrites `[core] ACTIVE_DATABASE`, runs `./cms config sync`, and restacks whatever is currently running. It does not create a database and does not check that one exists: §6.1 must have run first. To go back, `./cms db use default`.

### 6.4 Apply the schema — required, and not automatic

**A created database is completely empty.** No tables, no migrations, no roles, no grants, and no row-level security. `db create` runs one statement and nothing else; there is no `cms db migrate` verb, and `scripts/__db_admin.sh` contains no migration invocation.

A fresh database needs the full migration history applied separately:

```bash
make cms-init
make prisma-sync
```

`make cms-init` runs `scripts/__cms-db-init.sh`, which on a genuinely empty database runs `cmsInitDB` (26 tables, 5 enums, 5 domains, 46 CHECK constraints) and applies `scripts/__fix_db_schema.sql`. `make prisma-sync` bootstraps the two roles and then runs `prisma migrate deploy` plus the permission seed. The two migrations that enable and force RLS on all 33 application tables run inside that history, so **a database that skipped them is not hardened** and must not be exposed.

[`DB-MIGRATION-CUTOVER-RUNBOOK.md`](DB-MIGRATION-CUTOVER-RUNBOOK.md) §3 owns the detail of both steps, §4 the verification queries, §5 the failure handling. Do not treat §6.4 as optional: services pointed at an unmigrated database fail at connect time with a missing-relation error.

## 7. Pass criteria

Run from the repository root. Substitute your own names for `cmsdb` / `cmsdb_archive`.

1. **The names resolved as intended.** Exactly one of the two exists, and it is the new one.
   ```bash
   docker exec cms-database psql -U cmsuser -d postgres -tAc \
     "SELECT datname FROM pg_database WHERE datname IN ('cmsdb','cmsdb_archive') ORDER BY datname;"
   ```
   Expected after a rename: a single row, `cmsdb_archive`.

2. **No profile still names the old database.**
   ```bash
   grep -n 'POSTGRES_DB' config.toml
   ```
   Expected: every active `[db_<profile>]` names the new database.

3. **`.env` agrees with `config.toml`.**
   ```bash
   grep '^POSTGRES_DB=' .env
   ```
   Expected: the new name. If this still shows the old one, `./cms config sync` did not run or selected a different profile.

4. **The renamed database accepts connections.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb_archive -tAc "SELECT 1;"
   ```
   Expected: `1`. A connection refusal means the final `ALTER DATABASE ... ALLOW_CONNECTIONS true` did not run; the error names the statement to re-issue.

5. **The schema is present** — for a database that went through §6.4, or for the renamed archive that already carried it.
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb_evaluate -tAc \
     "SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE';"
   ```
   Expected: `34` (26 `cmsInitDB` tables + 6 RBAC tables + `monitor_targets` + `_prisma_migrations`). Anything less means the migration history was not applied.

6. **RLS is enabled and forced on every application table** — the check that distinguishes a properly migrated database from an empty one.
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb_evaluate -tAc \
     "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity);"
   ```
   Expected: exactly one row, `_prisma_migrations`. Runbook §4.2 explains why the unscoped variant is misleading.

7. **Services and application.** `./cms status`, `./cms test`, `./cms doctor` pass. Log in to the admin panel and open a contest — a page that loads proves a real connection, which a container-status check does not.

8. **Backups still work.** `./cms backup` succeeds. Under forced RLS the dump runs as `cms_backup`, not as the owner; a `permission denied` here means the role bootstrap did not run on this database.

## 8. When a step fails

- **`REFUSED: 'create' mutates the database and there is no terminal to confirm on.`** — stdin was not a TTY, so the interactive prompt was unavailable. Re-run with `CONFIRM_DB_ADMIN=yes`. Do not work around this by piping `yes` into the command; the environment variable is the supported non-interactive path.
- **`Aborted. The database was not modified.`** — the terminal prompt was answered with something other than `yes`. Nothing ran. Re-run and type `yes`.
- **`invalid <label> '<name>' — database identifiers must match ^[a-z_][a-z0-9_]{0,50}$`** — the name contains an upper-case letter, a hyphen, or a dot, or is over 51 characters. PostgreSQL would fold some of these; the script refuses rather than rely on server-side folding.
- **`'<name>' is not a database — 'template0', 'template1', 'postgres' and 'all' are not valid targets`** — reserved name.
- **`source database "<old>" does not exist`** — the name is wrong, or it was already renamed. `./cms db use <profile>` and the `pg_database` query from §7.1 show what exists.
- **`target database "<new>" already exists — refusing to rename onto it`** — choose another target name. Postgres cannot rename onto an existing database.
- **`could not take "<old>" out of service — the database was NOT renamed`** — the first `ALTER DATABASE` failed. Nothing changed. Check container health and permissions.
- **`could not drop the sessions on "<old>" — it accepts connections again`** — the script re-opened the source database before exiting. Nothing was renamed. Find the session holder with `docker logs cms-database -f`.
- **`"<old>" accepts connections again; the database was NOT renamed`** — the `ALTER ... RENAME` itself failed, and the script has already restored connections to the source. PostgreSQL refuses a rename while any session is attached. The script prints the blocking sessions from `pg_stat_activity` as `datname | user | application | pid`; terminate those and re-run.
- **`renamed to "<new>" but it still refuses connections — run: ALTER DATABASE "<new>" WITH ALLOW_CONNECTIONS true`** — the rename succeeded and the re-open did not. **The data is intact and renamed**; this is the one failure after which the name has changed. Issue the printed statement inside `cms-database` to finish.
- **`config.toml is missing or unreadable`** in the post-rename profile report — the script cannot enumerate the stale profiles. Use `grep -n 'POSTGRES_DB' config.toml` and complete §5.3 by hand.
- **Services fail to connect after a completed rename** — the repoint was skipped or `config sync` did not run. Verify §7.2 and §7.3, re-run `./cms config sync`, then `./cms deploy core`.

## 9. Known gaps

An operator must do these by hand. The tooling does not do them, and each one leaves the deployment broken if skipped.

1. **The repoint.** Neither verb writes `config.toml` or `.env`. Every `[db_<profile>]` naming the old database must be repointed and `./cms config sync` re-run. Until then the stack is configured with a name that no longer exists.
2. **The migrations.** `create` produces an empty database. The full `make cms-init` + `make prisma-sync` history — including the two RLS migrations — is a separate, required step (§6.4).
3. **The roles.** `cmsuser` and `cms_backup` are per-database. `make prisma-sync` creates them via `scripts/__apply_sql.sh --bootstrap-roles`; nothing in `create` or `rename` does.
4. **The redeploy.** `config sync` rewrites files; it does not restart anything. Services keep the old `POSTGRES_DB` until they are recreated.
5. **No drop.** There is no supported way to delete a database through `./cms`. Archive and rotate; remove by hand with `psql` only when the name is genuinely obsolete.
6. **`rename` drops live sessions.** There is no online, zero-disruption path here. The connection pools are terminated and error until the repoint and redeploy complete.
7. **The profile report reads `config.toml` only.** It cannot see a database that no profile points at, and it cannot detect a stale `POSTGRES_DB` that was never written as a plain quoted string. The grep in §4.6 is the manual cross-check.
8. **Discovery.** Neither verb is in `./cms help` or `./cms db --help`; the Rust TUI does not implement them and `cms` intercepts them before the TUI runs. This document and the README table are the discovery path.
