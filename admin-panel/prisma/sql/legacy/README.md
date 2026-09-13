# Legacy SQL — historical, not part of migration history

The files in this directory are one-shot upgrade steps that were already
applied everywhere and are no-ops on the current schema. They are kept
for audit history but **must not be re-applied** and are not part of
`admin-panel/prisma/migrations/`. Do not move them back to `admin-panel/prisma/sql/`
and do not add them to any automated apply path.

`2026-08-admin-columns.sql` is historical — its additive columns are already covered by the migration baseline and it must not be re-applied.
