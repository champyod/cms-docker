/**
 * Selective-backup table catalog.
 *
 * Names and primary keys mirror admin-panel/prisma/schema.prisma; the two files
 * must be updated together or a partial dump restores without the PKs the
 * archive browser expects.
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
  readonly pk: string[];
  readonly needsLargeObjects?: boolean;
}

export interface TableSelectionResult {
  readonly valid: boolean;
  readonly unknown: string[];
  readonly warnings: string[];
}

export const BACKUP_TABLES: readonly BackupTable[] = [
  { name: 'contests', label: 'Contests', pk: ['id'] },
  { name: 'users', label: 'Users', pk: ['id'] },
  { name: 'teams', label: 'Teams', pk: ['id'] },
  { name: 'tasks', label: 'Tasks', pk: ['id'] },
  { name: 'participations', label: 'Participations', pk: ['id'] },
  { name: 'datasets', label: 'Datasets', pk: ['id'] },
  { name: 'statements', label: 'Statements', pk: ['id'] },
  { name: 'attachments', label: 'Attachments', pk: ['id'] },
  { name: 'messages', label: 'Messages', pk: ['id'] },
  { name: 'questions', label: 'Questions', pk: ['id'] },
  { name: 'submissions', label: 'Submissions', pk: ['id'] },
  { name: 'user_tests', label: 'User Tests', pk: ['id'] },
  { name: 'submission_results', label: 'Submission Results', pk: ['submission_id', 'dataset_id'] },
  { name: 'testcases', label: 'Testcases', pk: ['id'] },
  { name: 'evaluations', label: 'Evaluations', pk: ['id'] },
  { name: 'executables', label: 'Executables', pk: ['id'] },
  { name: 'files', label: 'Submission Files', pk: ['id'] },
  { name: 'managers', label: 'Managers', pk: ['id'] },
  { name: 'tokens', label: 'Tokens', pk: ['id'] },
  { name: 'user_test_results', label: 'User Test Results', pk: ['user_test_id', 'dataset_id'] },
  { name: 'user_test_files', label: 'User Test Files', pk: ['id'] },
  { name: 'user_test_managers', label: 'User Test Managers', pk: ['id'] },
  { name: 'user_test_executables', label: 'User Test Executables', pk: ['id'] },
  { name: 'fsobjects', label: 'File System Objects', pk: ['digest'], needsLargeObjects: true },
];

export const BACKUP_TABLE_NAMES: readonly string[] = BACKUP_TABLES.map((table) => table.name);

/**
 * Direct foreign-key parents, read from schema.prisma `@relation(fields:)` lines.
 * Only catalog tables appear: a parent the catalog omits cannot be selected, so
 * warning about it would be unactionable.
 *
 * `admins` is absent from this catalog and is still referenced by `messages` and
 * `questions`; a restore that includes those tables therefore also needs `admins`.
 * The `tasks` -> `datasets` edge is omitted as the deliberate cycle break above.
 */
const PARENT_TABLES: Readonly<Record<string, readonly string[]>> = {
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
 * Tables whose rows are useless without `fsobjects`. Each stores a content
 * `digest` that resolves to a large object; `submissions` carries no digest of
 * its own but heads the whole content-addressed subtree.
 */
const LARGE_OBJECT_CONSUMERS: readonly string[] = [
  'attachments',
  'executables',
  'files',
  'managers',
  'statements',
  'submissions',
  'user_test_executables',
  'user_test_files',
  'user_test_managers',
];

function buildMissingParentWarnings(selected: ReadonlySet<string>): string[] {
  const warnings: string[] = [];
  for (const table of BACKUP_TABLES) {
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
  if (selected.has('fsobjects')) return [];
  const consumers = LARGE_OBJECT_CONSUMERS.filter((name) => selected.has(name));
  if (consumers.length === 0) return [];
  return [`"fsobjects" is missing: ${consumers.join(', ')} would be backed up without the large objects their digests point at.`];
}

/**
 * Rejects any name outside the catalog. Unknown names short-circuit the warnings
 * so a typo is never reported as a foreign-key or large-object problem.
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
  return { valid: true, unknown: [], warnings: [...buildMissingParentWarnings(selected), ...buildLargeObjectWarnings(selected)] };
}