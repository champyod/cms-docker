# Migration instructions — prod upgrade to the permission/RBAC release

How to take a running production deployment from the old build to this branch.

## Read this first

This release changes the **database schema** (drops 5 columns), **rewrites the permission model**, adds **RLS**, adds an **RPC shared secret**, and adds **least-privilege DB roles**. It is not a routine pull-and-restart.

Two consequences to accept up front:

1. **It is a hard cutover, not a rolling update.** The old and new admin panels cannot both run against the migrated database (the old one selects the dropped `permission_*` columns). Plan a short maintenance window.
2. **`make env` MUST run before services restart.** The RPC secret is fail-closed: if `config/cms.toml` has no `[rpc] secret`, every inter-service RPC is rejected and the cluster stops working. `config sync` generates it.

## Pre-flight

```bash
cd <repo>
git status                      # must be clean
./cms doctor                    # preflight: disk, docker, env, ports
```

Take a backup you can verify:

```bash
./cms backup                    # must succeed — confirm the archive exists
```

**If this backup fails, stop.** Every later step assumes you can restore.

## Step 1 — get the new code

The work is on `feat/requirements-catalog`. Either merge it to your deploy branch first, or check it out directly:

```bash
git fetch origin
git checkout feat/requirements-catalog
```

## Step 2 — run the upgrade

This is the whole migration. It pulls code, regenerates env, creates the DB roles, takes a safety backup, restarts each detected stack, then syncs the schema:

```bash
./cms update-server
```

Equivalent without the TUI: `make update-server` or `bash scripts/__update-server.sh`.

What it does, in order, and why the order matters:

| Step | Action | Why this position |
|---|---|---|
| 1 | records old git HEAD + image digests to `/tmp/cms-update-*.txt` | your rollback reference |
| 2 | `git pull --ff-only` | get the new code |
| 3 | `make env` → regenerates `.env` + `config/cms.toml` | generates the new `RPC_SECRET` and the role passwords; without this the RPC layer fails closed |
| 4 | bootstraps DB roles | the new admin container connects as `cms_admin` and the monitor as `cms_monitor`; they must exist **before** the restart |
| 5 | preflight | abort cleanly before touching anything running |
| 6 | safety backup | restore point for this specific upgrade |
| 7 | detects active stacks, pulls images, restarts them | new code, new credentials |
| 8 | `make cms-init` + `make prisma-sync` | applies the schema change, seeds permissions, then applies roles + RLS last |

Step 8 is where the destructive part lands: `prisma db push` adds the new tables, the boolean data is captured and backfilled into groups, then the 5 columns are dropped, then RLS is enabled and the owner is demoted.

## Step 3 — verify

```bash
./cms status                    # all services up
./cms test                      # smoke test
./cms doctor                    # post-check
```

Then confirm the migration actually took effect:

```bash
# the new permission tables exist and were seeded
docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
  "SELECT count(*) FROM permissions;"        # expect ~200
docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
  "SELECT count(*) FROM groups;"             # expect 8

# the 5 legacy booleans are gone
docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
  "SELECT count(*) FROM information_schema.columns
   WHERE table_name='admins' AND column_name LIKE 'permission\_%';"   # expect 0

# RLS is on everywhere
docker exec cms-database psql -U cmsuser -d cmsdb -tAc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);"        # expect 0

# backups work under the new RLS
./cms backup
```

**Log in to the admin panel before declaring success.** The single most important check: the migration preserves legacy access by mapping the old booleans into groups — confirm a real admin still has their permissions, and that the audit page shows entries.

## Rollback

`update-server` does **not** roll back automatically — it records state and fails loudly. If verification fails:

```bash
cat /tmp/cms-update-<timestamp>.txt      # old git HEAD + image digests
git checkout <old git_head>
# restore the pre-upgrade dump:
./cms restore <archive>
./cms deploy all
```

The database rollback matters more than the code rollback: the schema change is one-way. Restore the dump if you need to go back.

## What changed for you operationally

- **`make env` is now mandatory before restart**, not optional. The RPC secret is fail-closed.
- **One `.env` instead of six.** Edit `config.toml` and re-run `./cms config sync` — never edit `.env` by hand, it is overwritten.
- **`make env` now adds newly-introduced config keys** to an existing `config.toml` without touching values you already set.
- **New secrets are generated automatically**: `RPC_SECRET`, and `POSTGRES_SERVICE/ADMIN/MONITOR/BACKUP_PASSWORD`. Nothing to set by hand.
- **Backups use a new `cms_backup` role.** On the first upgrade the role may not exist yet at backup time; the script falls back to the owner and says so.
- **The DB owner `cmsuser` is demoted** (NOSUPERUSER/NOBYPASSRLS) so RLS actually binds. DDL still works because it owns its objects.

## Known limits of this upgrade

- Not exercised on a real production dataset: the migration logic was tested against constructed old-schema fixtures, not a production dump. **Rehearse on a restored copy first** if you can.
- The contestant-facing impersonation bypass is fixed here, so any workflow that relied on `admin_token` impersonation now requires `contest_admin_token` to be configured. Set it in `config.toml` before upgrading if you use that feature.
