import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { LARGE_OBJECT_TABLE } from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, PrivilegeFacts, TableStrategy } from '@/lib/restore-apply';

export const PREVIEW_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const STAGING = 'restore_staging_a1b2c3d4';
export const EPOCH = Date.UTC(2026, 9, 2, 12, 0, 0);

/** Every catalog table merged, unless a test narrows the selection. */
export function mergeAll(overrides: ApplyStrategies = {}): Record<string, TableStrategy> {
  const strategies: Record<string, TableStrategy> = {};
  for (const table of BACKUP_TABLE_NAMES) strategies[table] = 'merge';
  return { ...strategies, ...overrides };
}

/**
 * The live side of a realistic CMS schema: serial id primary keys, composite
 * keys on the two result tables, a text key on fsobjects, nullable admin_id on
 * the three admin-referencing tables, and the foreign keys Prisma creates as
 * plain non-deferrable constraints.
 */
/** No privilege rows on either side, so a plan reports nothing about them until a test supplies some. */
export function privilegeFacts(overrides: Partial<PrivilegeFacts> = {}): PrivilegeFacts {
  return {
    archiveAccounts: [],
    liveAccounts: [],
    archiveMemberships: [],
    liveMemberships: [],
    archiveOverrides: [],
    liveOverrides: [],
    accountConflicts: [],
    ...overrides,
  };
}

export function liveFacts(overrides: Partial<ApplyFacts> = {}): ApplyFacts {
  const tables = BACKUP_TABLE_NAMES;
  const composite = new Set(['submission_results', 'user_test_results']);
  return {
    scratchAlive: true,
    archiveTables: new Set(tables),
    archiveRows: new Map(tables.map((table) => [table, 10])),
    archiveColumns: new Map(tables.map((table) => [table, table === LARGE_OBJECT_TABLE ? ['digest', 'loid', 'description'] : ['id', 'name']])),
    liveRows: new Map(tables.map((table) => [table, 4])),
    liveColumns: new Map(tables.map((table) => [table, table === LARGE_OBJECT_TABLE ? ['digest', 'loid', 'description'] : ['id', 'name']])),
    livePkColumns: new Map(
      tables.map((table) => [
        table,
        composite.has(table)
          ? table === 'submission_results'
            ? ['submission_id', 'dataset_id']
            : ['user_test_id', 'dataset_id']
          : [table === LARGE_OBJECT_TABLE ? 'digest' : 'id'],
      ]),
    ),
    liveFkParents: new Map([
      ['admin_groups', ['admins', 'groups']],
      ['admin_permission_overrides', ['admins', 'permissions']],
      ['announcements', ['contests', 'admins']],
      ['attachments', ['tasks']],
      ['datasets', ['tasks']],
      ['evaluations', ['datasets', 'submission_results', 'submissions', 'testcases']],
      ['files', ['submissions']],
      ['group_permissions', ['groups', 'permissions']],
      ['messages', ['participations', 'admins']],
      ['participations', ['contests', 'teams', 'users']],
      ['questions', ['participations', 'admins']],
      ['statements', ['tasks']],
      ['submission_results', ['datasets', 'submissions']],
      ['submissions', ['participations', 'tasks']],
      ['tasks', ['contests']],
      ['teams', ['users']],
      ['testcases', ['datasets']],
      ['tokens', ['submissions']],
      ['user_tests', ['participations', 'tasks']],
    ]),
    archiveDigestCount: 100,
    archiveDigestBytes: 40 * 1024 * 1024,
    liveDigestCount: 80,
    missingDigestCount: 20,
    missingDigestBytes: 10 * 1024 * 1024,
    databaseSizeBytes: 1024 * 1024 * 1024,
    privileges: privilegeFacts(),
    uniqueConflicts: [],
    uniqueCheckSkipped: false,
    ...overrides,
  };
}