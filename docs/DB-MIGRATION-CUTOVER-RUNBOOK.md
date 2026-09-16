# Database migration cut-over runbook

How to take the production database from the pre-RBAC schema onto the Prisma-managed migration history. Read `UPGRADE-RBAC-RELEASE.md` first — this runbook is the database-level detail behind it and does not contradict it.

## Contents

1. [What the upgrade does to the database](#1-what-the-upgrade-does-to-the-database)
2. [Preconditions](#2-preconditions)
3. [The sequence](#3-the-sequence)
4. [Pass criteria](#4-pass-criteria)
5. [When a step fails](#5-when-a-step-fails)
6. [Rollback](#6-rollback)
7. [Known asymmetries](#7-known-asymmetries)

## 1. What the upgrade does to the database

- **One target schema, two starting points.** A fresh install runs `cmsInitDB` (26 tables, 5 enums, 5 domains, 46 CHECK constraints); an upgrade skips `cmsInitDB` because the `contests` table already exists. Both paths then run the same guarded migrations and converge on the identical 33-table schema with identical grants.
- The 6 RBAC tables — `permissions`, `groups`, `group_permissions`, `admin_groups`, `admin_permission_overrides`, `audit_log` — are created by the migration history only.
- All 33 application tables end with ROW LEVEL SECURITY **enabled and forced**. `_prisma_migrations` (Prisma's own ledger) is the only table in `public` without RLS.
- Exactly two database roles: `cmsuser` (owner, demoted) and `cms_backup` (BYPASSRLS, member of `cmsuser`, used by `pg_dump`). On the current production database `cms_backup` does not exist yet — it is created during this upgrade.
- The 5 `permission_*` boolean columns on `admins` are captured to `cms_legacy._legacy_admin_permissions`, backfilled into group memberships, then dropped. **Forward-only:** there is no in-place undo; rollback means restoring the pre-upgrade dump (§6).
- The old and new admin panels cannot run against the same schema. This is a hard cutover — schedule a maintenance window.

## 2. Preconditions

1. `git status` clean; `./cms doctor` passes.
2. `./cms config sync` has run and `.env` contains `POSTGRES_BACKUP_PASSWORD` (generated automatically). Without it the role bootstrap cannot set the `cms_backup` password.
3. **Take the backup first.** `./cms backup` — confirm the archive exists under `backups/db/`. If it fails, stop; every later step assumes you can restore. On the pre-upgrade database the dump runs as `cmsuser` (RLS is not yet active). After the upgrade the owner can no longer dump under forced RLS — backups then require `cms_backup`.
4. Note the update record: `./cms update-server` writes the old git HEAD and running image digests to `/tmp/cms-update-<timestamp>.txt`. Keep that file — it is the code rollback reference.
5. Make sure no scheduled backup fires inside the window.
6. Close contests and announce downtime: services restart mid-procedure and the schema change is destructive. Do not reopen until §4 passes.

## 3. The sequence

Run:

```bash
./cms update-server
```

Equivalent: `bash scripts/__update-server.sh`. (There is no `make update-server` target.)

It performs, in order:

| # | Step | Notes |
|---|---|---|
| 1 | Record pre-update state | git HEAD + image digests → `/tmp/cms-update-<timestamp>.txt` |
| 2 | `git pull --ff-only` | **The code pull happens here** — before any schema step |
| 3 | `make env` | Regenerates `.env`; the RPC secret is fail-closed, so this must succeed before the restart |
| 4 | `scripts/__apply_sql.sh --bootstrap-roles` | Creates/updates the two roles **before** services restart, so `cms_backup` can connect |
| 5 | `scripts/__preflight.sh --stack all` | Aborts cleanly if the host is not ready |
| 6 | `scripts/__backup.sh` | Safety backup for this specific upgrade; aborts the update if it fails |
| 7 | Pull images, restart detected stacks | New code starts; the DB steps come after |
| 8 | `make cms-init` | See §3.1 |
| 9 | `make prisma-sync` | See §3.2 |
| 10 | Health checks | Prints DB / admin panel / contest web PASS or FAIL |

`cms-init` runs **before** `prisma-sync` on this path and on the `./cms` bootstrap lifecycle alike. Keep the window open until §4 passes.

### 3.1 `make cms-init`

`scripts/__cms-db-init.sh`:

1. Verifies database connectivity using `.env`.
2. **Skips `cmsInitDB` whenever the `contests` table exists** — the upgrade path always lands here. On a fresh database it runs `cmsInitDB`, which creates the 26 CMS tables, 5 enums, 5 domains and 46 CHECK constraints; the 6 RBAC tables are deliberately excluded.
3. Applies `scripts/__fix_db_schema.sql` — idempotent column patches (see §7).

### 3.2 `make prisma-sync`

1. `scripts/__apply_sql.sh --bootstrap-roles` — role definitions only (no RLS, no grants) with the `cms_backup` password from `.env`.
2. **Baseline check (P3005 mitigation).** `prisma migrate deploy` fails with P3005 on any database that has objects but no `_prisma_migrations` ledger — which covers upgrades **and** fresh installs, because `cms-init` always runs first. When the target detects tables in `public` but no ledger, it marks the empty marker migration applied:
   ```
   prisma migrate resolve --applied 20260910000000_baseline_marker
   ```
   Otherwise it prints `Baseline not needed`. This step fires only on the objects-without-ledger condition — never on an already-migrated database.
3. `prisma migrate deploy` — applies the pending migrations in filename order (§3.3).
4. Seeds the permission registry (`admin-panel/prisma/seed-permissions.ts`): upserts the permissions, the 8 seeded groups and the group→permission links. Idempotent. **The seed runs after `migrate deploy`** — which is why the backfill seeds its own groups (§3.3).

### 3.3 The migrations, in order

| Migration | Does | Guard |
|---|---|---|
| `20260910000000_baseline_marker` | Empty marker; baseline target for `migrate resolve` | Intentionally no DDL |
| `20260912000000_admin_panel_objects` | Creates the 6 RBAC tables + `monitor_targets`, indexes, FKs; `audit_log.actor_id` FK to `admins` with orphan check | `to_regclass` per table; constraint-name checks |
| `20260912000050_prisma_columns_in_cms_tables` | Adds the Prisma-only columns to `contests`, `admins`, `users`, `teams` + `teams.leader_id` FK | `ADD COLUMN IF NOT EXISTS`; constraint-name check |
| `20260912000100_capture_legacy_permissions` | Creates `cms_legacy._legacy_admin_permissions` and copies the 5 booleans | Column-existence checks; `ON CONFLICT DO NOTHING`; never drops the table |
| `20260912000120_backfill_permission_booleans` | Seeds the 5 linked groups, then maps booleans → `admin_groups` | Group/table existence; `ON CONFLICT DO NOTHING` |
| `20260912000130_drop_permission_booleans` | Drops the 5 `permission_*` columns | `DROP COLUMN IF EXISTS`; never drops the capture table |
| `20260912000140_contests_queue_fairness_check` | Adds the `queue_fairness_penalty_seconds >= 0` CHECK | Skips if column absent or an equivalent CHECK exists |
| `20260912000150_backup_grants` | Database-scoped SELECT/USAGE grants for `cms_backup`, incl. `pg_largeobject` | **RAISES if `cms_backup` is missing — by design** (§5) |
| `20260912000300_rls_enable` | `ENABLE` + `FORCE ROW LEVEL SECURITY` on all 33 tables | `to_regclass` per table |
| `20260912000400_rls_policies` | Permissive `cmsuser` policies; `audit_log` append-only (no UPDATE/DELETE policy); `submissions` full verbs | `DROP POLICY IF EXISTS` before each create |
| `20260912000500_owner_hardening` | Demotes `cmsuser` to `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` | Skips if role missing or already demoted |

Two orderings matter:

- The backfill links admins to `Superadmin`, `Problem Setter`, `Contest Manager`, `Messaging` and `Viewer`, and **creates those 5 group rows itself** before linking, because the permission seed that normally creates them runs only after `migrate deploy`. Without this the backfill would link nothing.
- Every migration is guarded and idempotent. A partial run resumes cleanly (§5).

### 3.4 Manual path

If `update-server` cannot be used, run the same order by hand:

```bash
make env                                       # alias of ./cms config sync
make core                                      # database + core services up
make cms-init
bash scripts/__apply_sql.sh --bootstrap-roles  # role preflight — must succeed
make prisma-sync
make admin
make contest
make worker                                    # only if a worker fleet is deployed
make infra                                     # monitor
```

The `./cms` no-argument lifecycle performs the same order (`env → core → cms-init → preflight → prisma-sync → admin → contest → worker → monitor`); its preflight step queries `pg_roles` for `cmsuser` and `cms_backup`, bootstraps missing roles via `scripts/__apply_sql.sh --bootstrap-roles`, and **stops before `prisma-sync`** if the bootstrap fails.

## 4. Pass criteria

Run from the repo root. `psql` examples use the default names; substitute `POSTGRES_USER` / `POSTGRES_DB` from `.env` if changed.

1. **Table count — 33 application tables + the ledger.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE';"
   ```
   Expected: `34` (26 original tables + 6 RBAC tables + `monitor_targets` + `_prisma_migrations`).

2. **RLS enabled and forced on all 33 application tables.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND c.relrowsecurity AND c.relforcerowsecurity;"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity);"
   ```
   Expected: `33`, then exactly one row: `_prisma_migrations` (§7). Do not use an unscoped "0 tables without RLS in public" check — the ledger makes it return 1.

3. **Exactly two roles, with the right attributes.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
      WHERE rolname IN ('cmsuser','cms_backup') ORDER BY rolname;"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM pg_auth_members m
      JOIN pg_roles r ON r.oid=m.member  AND r.rolname='cms_backup'
      JOIN pg_roles g ON g.oid=m.roleid  AND g.rolname='cmsuser';"
   ```
   Expected: two rows — `cms_backup | t | f | t` and `cmsuser | t | f | f` — and membership count `1`.

4. **Migration ledger — 11 finished rows.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM _prisma_migrations;"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL;"
   ```
   Expected: `11` (1 baseline marker + 10 migrations), then `0`. The names match the directories under `admin-panel/prisma/migrations/`.

5. **Admins preserved, booleans gone, capture intact.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='admins'
        AND column_name LIKE 'permission\_%';"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM cms_legacy._legacy_admin_permissions;"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM admins;"
   ```
   Expected: `0`, then `7` (the production dataset), then `7`. The capture-table row count must equal the admin count.

6. **Admin group memberships.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT g.name, count(*) FROM admin_groups ag
      JOIN groups g ON g.id=ag.group_id GROUP BY g.name ORDER BY g.name;"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM admins a
      WHERE NOT EXISTS (SELECT 1 FROM admin_groups ag WHERE ag.admin_id=a.id);"
   ```
   Expected on the production dataset: 12 memberships — `Superadmin 4`, `Problem Setter 3`, `Contest Manager 2`, `Messaging 2`, `Viewer 1` — and no admin left without a group (`0`). These rows were created by the backfill **before** the permission seed ran; the seed does not touch `admin_groups`.

7. **Permission seed applied.**
   ```bash
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM permissions;"
   docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
     "SELECT count(*) FROM groups WHERE is_seeded;"
   ```
   Expected: ~200 permissions (one row per registry key) and 8 seeded groups — the 5 backfill-created groups plus `Judge`, `Data Correction`, `Storage Admin` added by the seed.

8. **Second deploy is a no-op.** Re-run `make prisma-sync`: `prisma migrate deploy` must report **no pending migrations**, and the seed must re-run cleanly (it is upsert-based).

9. **Services and application.** `./cms status`, `./cms test`, `./cms doctor` all pass. Log in to the admin panel — a real admin still has their permissions — and open the audit page.

10. **Backups under the new regime.** `./cms backup` succeeds; it now runs as `cms_backup` (the owner can no longer dump under forced RLS).

## 5. When a step fails

- **Backup or `make env` fails** → stop. Nothing has changed yet.
- **Role bootstrap fails** (update-server step 4, or the `./cms` preflight message `role bootstrap failed — fix DB roles then re-run`): ensure `.env` has `POSTGRES_BACKUP_PASSWORD` (`./cms config sync`) and `cms-database` is healthy, then re-run `bash scripts/__apply_sql.sh --bootstrap-roles`. Creating `cms_backup` (BYPASSRLS) requires superuser — still available at this point, because the owner demotion is the final migration.
- **The grants migration raises** `role cms_backup is missing — run the role bootstrap step before migrate deploy`: that is `20260912000150_backup_grants` failing **on purpose**. It is the last line of defence against continuing without the backup role, not a bug. Migrations before it are applied and committed. Fix the role (`bash scripts/__apply_sql.sh --bootstrap-roles`), then re-run `make prisma-sync`.
- **Any other migration fails part-way:** each migration runs in a single transaction, so the failed one leaves no partial state; everything before it stays applied and recorded. There is no rollback to a mid-list state. Resumption:
  1. Fix the cause.
  2. Re-run `make prisma-sync`. If deploy refuses because the migration is recorded as failed (P3018), mark it rolled back — same invocation style the target uses for the baseline marker:
     ```bash
     set -a; . ./.env; set +a
     docker exec -e DATABASE_URL="postgresql://${POSTGRES_USER:-cmsuser}:${POSTGRES_PASSWORD}@database:5432/${POSTGRES_DB:-cmsdb}" \
       cms-admin-panel-next sh -lc \
       "cd /repo-root/admin-panel && ./node_modules/.bin/prisma migrate resolve --rolled-back <migration_name> || npx --yes prisma@6 migrate resolve --rolled-back <migration_name>"
     ```
     Without the admin container: `cd admin-panel && DATABASE_URL="postgresql://${POSTGRES_USER:-cmsuser}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB:-cmsdb}" bun x prisma@6 migrate resolve --rolled-back <migration_name>`.
  3. Re-run `make prisma-sync`. Deploy re-applies that migration from its top; all statements are guarded, so this is safe.
- **`update-server` prints FAIL in its post-update summary** → no automatic rollback. It prints the record file path and manual steps; decide fix-forward vs rollback (§6). Do not reopen the contest while the decision is open.

## 6. Rollback

Migrations are forward-only. The only database recovery is restoring the pre-upgrade dump.

**Code and images first** (both recorded by `update-server`):

```bash
cat /tmp/cms-update-<timestamp>.txt      # git_head + repo_digests per container
git checkout <git_head>
docker pull <image>@<old repo_digest>    # or rebuild from the old commit
```

Roll the code back before restoring, so the old code and the old schema match again.

**Then the database:**

```bash
bash scripts/__restore.sh backups/db/cmsdb-<timestamp>.dump          # scratch rehearsal — restores into throwaway containers, live DB untouched, prints verification counts
bash scripts/__restore.sh backups/db/cmsdb-<timestamp>.dump --force  # live restore — stops core services, restores into cms-database
```

`./cms restore <archive>` is the same restore entrypoint. The restore pre-creates `cms_backup` as a `NOLOGIN` stub so the dump's grants load cleanly, then re-applies the real role definitions (`--bootstrap-roles`). After a live restore:

```bash
./cms deploy all
```

Then re-verify row counts against the pre-upgrade values and log in.

**The permission rollback record:** `cms_legacy._legacy_admin_permissions` is deliberately retained after the upgrade — no migration drops it, and the drop migration explicitly preserves it. It holds the pre-migration boolean values for every admin (7 rows on the production dataset) and is the authoritative record of who had what before the group mapping. Backups include it: the backup role reaches the `cms_legacy` schema through its membership in `cmsuser`. A rollback via dump brings the boolean columns back with their original values.

## 7. Known asymmetries

- **`evaluations.admin_text` is patch-owned.** The column is declared by the CMS ORM and deliberately absent from `schema.prisma`; `scripts/__fix_db_schema.sql` (applied by `make cms-init` on every run, both paths) owns it. Do not add it to the Prisma schema without removing the patch, and vice versa.
- **`audit_log.actor_id` carries its foreign key.** `audit_log_actor_id_fkey` references `admins(id)` (`ON UPDATE CASCADE ON DELETE SET NULL`) and is created by the object migration; its orphan check fails loudly with a count instead of silently nulling rows.
- **`_prisma_migrations` has no RLS.** It is Prisma's own ledger, not an application table, and the RLS migrations scope to the 33 application tables. Scope any RLS verification accordingly (§4.2).
