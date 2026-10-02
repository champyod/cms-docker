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
}

export interface TableSelectionResult {
  readonly valid: boolean;
  readonly unknown: string[];
  readonly warnings: string[];
}

const CATALOG = [
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
  { name: 'fsobjects', label: 'File System Objects', pk: ['digest'], needsLargeObjects: true },
] as const satisfies readonly BackupTable[];

export const BACKUP_TABLES: readonly BackupTable[] = CATALOG;

export const BACKUP_TABLE_NAMES: readonly string[] = CATALOG.map((table) => table.name);

type CatalogTableName = (typeof CATALOG)[number]['name'];

const LARGE_OBJECT_TABLE = 'fsobjects';
const ADMIN_TABLE = 'admins';

const EMPTY_SELECTION_WARNING = 'No tables selected: pg_dump with zero -t flags dumps the entire database, so an empty selection is rejected.';

/**
 * Direct foreign-key parents, read from schema.prisma `@relation(fields:)` lines.
 * Only catalog tables appear: a parent the catalog omits cannot be selected, so
 * warning about it would be unactionable. Keys are typed as catalog names, so a
 * misspelled key is a type error instead of a warning that never fires.
 *
 * `admins` is absent from this catalog and is still referenced by
 * `announcements`, `messages` and `questions`; see ADMIN_REFERENCE_TABLES for the
 * warning that covers it. The `tasks` -> `datasets` edge is omitted as the
 * deliberate cycle break above.
 */
const PARENT_TABLES: Readonly<Partial<Record<CatalogTableName, readonly string[]>>> = {
  announcements: ['contests'],
  attachments: ['tasks'],
  datasets: ['tasks'],
  evaluations: ['datasets', 'submission_results', 'submissions', 'testcases'],
  executables: ['datasets', 'submission_results', 'submissions'],
  files: ['submissions'],
  managers: ['datasets'],
  messages: ['participations'],
  participations: ['contests', 'teams', 'users'],
  questions: ['participations'],
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
 * Tables holding a nullable `admin_id` that points at `admins`. `admins` is
 * deliberately not archived, so the reference cannot be restored as-is: it
 * stays dangling until Epic 3 remaps it to a live admins row. Kept apart from
 * PARENT_TABLES because the parent is outside the catalog and never selectable.
 */
const ADMIN_REFERENCE_TABLES: readonly CatalogTableName[] = ['announcements', 'messages', 'questions'];

function buildMissingParentWarnings(selected: ReadonlySet<string>): string[] {
  const warnings: string[] = [];
  for (const table of CATALOG) {
    if (!selected.has(table.name)) continue;
    const parents = PARENT_TABLES[table.name] ?? [];
    const missing = parents.filter((parent) => !selected.has(parent));
    if (missing.length > 0) {
      warnings.push(`"${table.name}" references ${missing.join(', ')}, which is not selected; the restore will fail its foreign keys.`);
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

function buildAdminReferenceWarnings(selected: ReadonlySet<string>): string[] {
  const referencing = ADMIN_REFERENCE_TABLES.filter((name) => selected.has(name));
  if (referencing.length === 0) return [];
  return [
    `"${ADMIN_TABLE}" is never archived: ${referencing.join(', ')} keep an admin_id that dangles after restore until Epic 3 remaps it to a live ${ADMIN_TABLE} row.`,
  ];
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
    ...buildAdminReferenceWarnings(selected),
  ];
  return { valid: true, unknown: [], warnings };
}