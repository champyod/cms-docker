# Changelog

## 2026-08-23 — One-stop entrypoint consolidation

- `./cms` is now the single user-facing entrypoint:
  - zero-argument run = full idempotent bootstrap lifecycle
    (prereqs → env → core → cms-init → prisma-sync → admin → contest → worker
    → monitor → admin-create → verify)
  - subcommands: `setup · update · fix · deploy <stack> [--img] · stop · clean ·
    pull · db init|reset|clean|sync · admin-create · status · monitor · backup
    [drill] · restore · doctor · test · worker connect|cgroup · contest create ·
    update-server · help`
- `cms update` walks configuration section-by-section (DB / Admin Panel /
  Ranking / Workers / Security) showing current values ([Enter=keep]) and
  offering generate/type for secrets; `cms fix` repairs missing or invalid
  values non-interactively.
- All operational and container-entrypoint scripts moved to the `scripts/__*`
  internal namespace (`__lib/`, `__update_engine.sh`, `__cms*` wrappers, ...);
  humans and agents should only invoke `./cms` or `make`.
- Removed absorbed scripts: `setup.sh`, `quick-start.sh`, `configure-env.sh`,
  `create-contests.sh`, `manage-workers.sh`, `monitor.sh`, `status.sh`,
  `stop-all.sh`, `backup-drill.sh`, `worker-connect.sh`,
  `setup-worker-cgroup.sh`.
- `make setup` now delegates to `./cms`; all Makefile, compose, workflow and
  docs references updated.
