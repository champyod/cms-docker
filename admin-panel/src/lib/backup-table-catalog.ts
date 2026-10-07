/**
 * Selective-backup table catalog.
 *
 * Names and primary keys mirror admin-panel/prisma/schema.prisma; the two files
 * must be updated together or a partial dump restores without the PKs the
 * archive browser expects. tests/backup-table-catalog.test.ts parses the schema
 * and fails on drift.
 *
 * Order is parent-before-child. `tasks` and `datasets` form a reference cycle in
 * the schema (datasets.task_id -> tasks.id, tasks.active_dataset_id ->
 * datasets.id), so that single edge cannot be satisfied in any order; it is
 * broken toward `tasks` first because `tasks.active_dataset_id` is nullable and
 * `onDelete: SetNull`, whereas `datasets.task_id` is not.
 *
 * `validateTableSelection` is the allowlist gate for the dump step. Table names
 * become shell arguments to `pg_dump`, so a name absent from this catalog must
 * never reach that command.
 */

export interface BackupTable {
  readonly name: string;
  readonly label: string;
  readonly pk: readonly string[];
  /**
   * The table stores a content `digest` that resolves to a `fsobjects` large
   * object, so its rows are incomplete without `fsobjects` in the dump. The flag
   * is the single source for the warning below and for the dump step's `-b`.
   *
   * `evaluations`, `submission_results` and `user_test_results` also name large
   * objects, through `*_sandbox_digests` string arrays instead of a per-row
   * `digest` column, and are deliberately not flagged. `submissions` has no
   * digest column of its own and is flagged only because it heads the
   * content-addressed subtree.
   */
  readonly needsLargeObjects?: boolean;
  /**
   * The table carries panel authority, or the material it is resolved from:
   * login hashes, group membership, or the permission rows membership resolves
   * to. Restoring one changes who may act rather than what they may act on, so
   * the validator warns on every one of them and the restore preview reports the
   * exact per-username differences before a single row is written.
   */
  readonly sensitive?: boolean;
}

export interface TableSelectionResult {
  readonly valid: boolean;
  readonly unknown: string[];
  readonly warnings: string[];
}

const CATALOG = [
  // Roots. Nothing the catalog selects above these resolves through one of them,
  // and three content tables name `admins` as the author of a row, so it leads.
  { name: 'admins', label: 'Admins', pk: ['id'], sensitive: true },
  { name: 'permissions', label: 'Permissions', pk: ['id'], sensitive: true },
  { name: 'groups', label: 'Groups', pk: ['id'], sensitive: true },
  { name: 'contests', label: 'Contests', pk: ['id'] },
  { name: 'announcements', label: 'Announcements', pk: ['id'] },
  { name: 'users', label: 'Users', pk: ['id'] },
  { name: 'teams', label: 'Teams', pk: ['id'] },
  { name: 'tasks', label: 'Tasks', pk: ['id'] },
  { name: 'participations', label: 'Participations', pk: ['id'] },
  { name: 'datasets', label: 'Datasets', pk: ['id'] },
  { name: 'statements', label: 'Statements', pk: ['id'], needsLargeObjects: true },
  { name: 'attachments', label: 'Attachments', pk: ['id'], needsLargeObjects: true },
  { name: 'messages', label: 'Messages', pk: ['id'] },
  { name: 'questions', label: 'Questions', pk: ['id'] },
  { name: 'submissions', label: 'Submissions', pk: ['id'], needsLargeObjects: true },
  { name: 'user_tests', label: 'User Tests', pk: ['id'] },
  { name: 'submission_results', label: 'Submission Results', pk: ['submission_id', 'dataset_id'] },
  { name: 'testcases', label: 'Testcases', pk: ['id'] },
  { name: 'evaluations', label: 'Evaluations', pk: ['id'] },
  { name: 'executables', label: 'Executables', pk: ['id'], needsLargeObjects: true },
  { name: 'files', label: 'Submission Files', pk: ['id'], needsLargeObjects: true },
  { name: 'managers', label: 'Managers', pk: ['id'], needsLargeObjects: true },
  { name: 'tokens', label: 'Tokens', pk: ['id'] },
  { name: 'user_test_results', label: 'User Test Results', pk: ['user_test_id', 'dataset_id'] },
  { name: 'user_test_files', label: 'User Test Files', pk: ['id'], needsLargeObjects: true },
  { name: 'user_test_managers', label: 'User Test Managers', pk: ['id'], needsLargeObjects: true },
  { name: 'user_test_executables', label: 'User Test Executables', pk: ['id'], needsLargeObjects: true },
  // No table in this catalog references any of these five, so they sit together
  // after everything that consumes them rather than among the content tables:
  // the three grant tables resolve through the roots above, and the two backup
  // tables have no relation to anything at all — `backup_runs.scheduleId` is a
  // bare string on purpose, because run history must outlive the schedule it
  // came from.
  { name: 'group_permissions', label: 'Group Permissions', pk: ['id'], sensitive: true },
  { name: 'admin_groups', label: 'Admin Groups', pk: ['id'], sensitive: true },
  { name: 'admin_permission_overrides', label: 'Admin Permission Overrides', pk: ['id'], sensitive: true },
  { name: 'backup_schedules', label: 'Backup Schedules', pk: ['id'] },
  { name: 'backup_runs', label: 'Backup Runs', pk: ['id'] },
  { name: 'fsobjects', label: 'File System Objects', pk: ['digest'], needsLargeObjects: true },
] as const satisfies readonly BackupTable[];

export const BACKUP_TABLES: readonly BackupTable[] = CATALOG;

export const BACKUP_TABLE_NAMES: readonly string[] = CATALOG.map((table) => table.name);

type CatalogTableName = (typeof CATALOG)[number]['name'];

export const ADMIN_TABLE = 'admins';
export const SCHEDULE_TABLE = 'backup_schedules';

/** The tables that decide who may act, from the permission key down to the link row. */
export const GRANT_TABLES: readonly string[] = CATALOG.filter((table) => 'sensitive' in table && table.sensitive && table.name !== ADMIN_TABLE).map((table) => table.name);

const LARGE_OBJECT_TABLE = 'fsobjects';

const EMPTY_SELECTION_WARNING = 'No tables selected: pg_dump with zero -t flags dumps the entire database, so an empty selection is rejected.';

/**
 * Direct foreign-key parents, read from schema.prisma `@relation(fields:)` lines.
 * Only catalog tables appear: a parent the catalog omits cannot be selected, so
 * warning about it would be unactionable. Keys are typed as catalog names, so a
 * misspelled key is a type error instead of a warning that never fires.
 *
 * The `tasks` -> `datasets` edge is omitted as the deliberate cycle break above.
 */
const PARENT_TABLES: Readonly<Partial<Record<CatalogTableName, readonly string[]>>> = {
  admin_groups: [ADMIN_TABLE, 'groups'],
  admin_permission_overrides: [ADMIN_TABLE, 'permissions'],
  announcements: ['contests', ADMIN_TABLE],
  attachments: ['tasks'],
  datasets: ['tasks'],
  evaluations: ['datasets', 'submission_results', 'submissions', 'testcases'],
  executables: ['datasets', 'submission_results', 'submissions'],
  files: ['submissions'],
  group_permissions: ['groups', 'permissions'],
  managers: ['datasets'],
  messages: ['participations', ADMIN_TABLE],
  participations: ['contests', 'teams', 'users'],
  questions: ['participations', ADMIN_TABLE],
  statements: ['tasks'],
  submission_results: ['datasets', 'submissions'],
  submissions: ['participations', 'tasks'],
  tasks: ['contests'],
  teams: ['users'],
  testcases: ['datasets'],
  tokens: ['submissions'],
  user_test_executables: ['datasets', 'user_test_results', 'user_tests'],
  user_test_files: ['user_tests'],
  user_test_managers: ['user_tests'],
  user_test_results: ['datasets', 'user_tests'],
  user_tests: ['participations', 'tasks'],
};

/**
 * Parent edges a nullable column makes optional. `admin_id` is nullable on all
 * three tables that carry it, so a selection without `admins` costs the restored
 * rows their authorship rather than the rows themselves: the applier writes
 * NULL. Every other edge in PARENT_TABLES is NOT NULL and does fail the restore.
 */
const NULLABLE_PARENT_TABLES: Readonly<Partial<Record<CatalogTableName, readonly string[]>>> = {
  announcements: [ADMIN_TABLE],
  messages: [ADMIN_TABLE],
  questions: [ADMIN_TABLE],
};

function buildMissingParentWarnings(selected: ReadonlySet<string>): string[] {
  const warnings: string[] = [];
  for (const table of CATALOG) {
    if (!selected.has(table.name)) continue;
    const missing = (PARENT_TABLES[table.name] ?? []).filter((parent) => !selected.has(parent));
    const optional = (NULLABLE_PARENT_TABLES[table.name] ?? []).filter((parent) => !selected.has(parent));
    const required = missing.filter((parent) => !optional.includes(parent));
    if (required.length > 0) {
      warnings.push(`"${table.name}" references ${required.join(', ')}, which is not selected; the restore will fail its foreign keys.`);
    }
    if (optional.length > 0) {
      warnings.push(`"${table.name}" references ${optional.join(', ')}, which is not selected; its nullable reference will be set to NULL on every restored row.`);
    }
  }
  return warnings;
}

function buildLargeObjectWarnings(selected: ReadonlySet<string>): string[] {
  if (selected.has(LARGE_OBJECT_TABLE)) return [];
  const consumers = CATALOG.filter(
    (table) => table.name !== LARGE_OBJECT_TABLE && selected.has(table.name) && 'needsLargeObjects' in table && table.needsLargeObjects,
  ).map((table) => table.name);
  if (consumers.length === 0) return [];
  return [`"${LARGE_OBJECT_TABLE}" is missing: ${consumers.join(', ')} would be backed up without the large objects their digests point at.`];
}

/** `admins` carries every panel login, so its warning says whether privileges ride along. */
function buildAdminWarnings(selected: ReadonlySet<string>): string[] {
  if (!selected.has(ADMIN_TABLE)) return [];
  const grants = GRANT_TABLES.filter((table) => selected.has(table));
  const privileges = grants.length === 0
    ? 'Privileges do not live in this table, so none are restored: a restored admin keeps whatever group membership the live database already grants it, and one restored onto an empty database has none at all.'
    : `Privileges do travel with this selection, because ${grants.join(', ')} ${grants.length === 1 ? 'is' : 'are'} selected too: the restore rewrites who may act, and the validate report lists the groups each admin gains and loses.`;
  return [`"${ADMIN_TABLE}" carries every panel login: restoring it rewrites the username, password hash and enabled flag of each admin row it matches by primary key. ${privileges}`];
}

function buildGrantWarnings(selected: ReadonlySet<string>): string[] {
  const grants = GRANT_TABLES.filter((table) => selected.has(table));
  if (grants.length === 0) return [];
  const named = grants.map((table) => `"${table}"`).join(', ');
  return [`${named} decide who may act, so this is not a backup of competition data but of the panel's authority itself. The validate report shows which admin gains and loses which group and override before the double-confirm; read it.`];
}

function buildScheduleWarnings(selected: ReadonlySet<string>): string[] {
  if (!selected.has(SCHEDULE_TABLE)) return [];
  return [`"${SCHEDULE_TABLE}" restores the backup poller's own schedule: an archived schedule that was enabled resumes firing on its archived interval once restored, so a restore can start new backups on its own.`];
}

function buildSensitivityWarnings(selected: ReadonlySet<string>): string[] {
  return [...buildAdminWarnings(selected), ...buildGrantWarnings(selected), ...buildScheduleWarnings(selected)];
}

/**
 * Rejects any name outside the catalog. Unknown names short-circuit the warnings
 * so a typo is never reported as a foreign-key or large-object problem. An empty
 * selection is rejected too, because it reaches `pg_dump` with no `-t` flag and
 * the command would dump the entire database.
 */
export function validateTableSelection(names: string[]): TableSelectionResult {
  const selected = new Set<string>();
  const unknown = new Set<string>();
  for (const name of names) {
    if (BACKUP_TABLE_NAMES.includes(name)) {
      selected.add(name);
    } else {
      unknown.add(name);
    }
  }
  if (unknown.size > 0) {
    return { valid: false, unknown: [...unknown], warnings: [] };
  }
  if (selected.size === 0) {
    return { valid: false, unknown: [], warnings: [EMPTY_SELECTION_WARNING] };
  }
  const warnings = [
    ...buildMissingParentWarnings(selected),
    ...buildLargeObjectWarnings(selected),
    ...buildSensitivityWarnings(selected),
  ];
  return { valid: true, unknown: [], warnings };
}