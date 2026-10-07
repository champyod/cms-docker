import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLE_NAMES, BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';

const SCHEMA_SOURCE = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');

/**
 * schema.prisma models the catalog leaves out on purpose: `admins` is never
 * archived because Epic 3 remaps admin_id to a live admins row instead, and
 * `monitor_targets`, `backup_schedules` and `backup_runs` are backup and
 * monitor configuration describing what to dump, not competition data to dump.
 *
 * The RBAC grant tables are out on the same reasoning as `admins`, one step
 * further: an archive of them would restore the permission rows themselves, so a
 * restore would overwrite who may act rather than what they may act on. A dump
 * that hands back the authority to run the restore is not a backup of the panel,
 * so `permissions`, `groups`, `group_permissions`, `admin_groups` and
 * `admin_permission_overrides` stay live-only, alongside `audit_log`, which is
 * an append-only record of what was authorized and must never be replayed.
 */
const MODELS_OUTSIDE_CATALOG: ReadonlySet<string> = new Set([
  'admins',
  'monitor_targets',
  'backup_schedules',
  'backup_runs',
  'permissions',
  'groups',
  'group_permissions',
  'admin_groups',
  'admin_permission_overrides',
  'audit_log',
]);

/** The tasks/datasets cycle no dump order can satisfy; see the catalog header. */
const UNSATISFIABLE_EDGES: ReadonlyArray<readonly [string, string]> = [['tasks', 'datasets']];

interface SchemaModel {
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly string[];
}

function parsePrimaryKey(modelBody: string): readonly string[] {
  const composite = modelBody.match(/@@id\(\[([^\]]+)\]/);
  if (composite?.[1] !== undefined) return composite[1].split(',').map((column) => column.trim());
  const inline = modelBody.match(/^[ \t]+(\w+)[ \t]+\S+[ \t]+@id\b/m);
  return inline?.[1] !== undefined ? [inline[1]] : [];
}

function parseForeignKeys(modelBody: string): readonly string[] {
  return modelBody
    .split('\n')
    .map((line) => line.match(/^[ \t]+\w+[ \t]+(\w+)\??[ \t]+@relation\([^)]*fields:/)?.[1])
    .filter((parent): parent is string => parent !== undefined);
}

function parseSchemaModels(source: string): Map<string, SchemaModel> {
  const models = new Map<string, SchemaModel>();
  for (const [, modelName, body] of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.set(modelName, { primaryKey: parsePrimaryKey(body), foreignKeys: parseForeignKeys(body) });
  }
  return models;
}

function missingParentWarnings(warnings: readonly string[]): readonly string[] {
  return warnings.filter((warning) => warning.includes('references '));
}

const SCHEMA_MODELS = parseSchemaModels(SCHEMA_SOURCE);

function positionOf(name: string): number {
  return BACKUP_TABLE_NAMES.indexOf(name);
}

describe('BACKUP_TABLES', () => {
  it('is non-empty and free of duplicate names', () => {
    expect(BACKUP_TABLES.length).toBeGreaterThan(0);
    expect(new Set(BACKUP_TABLE_NAMES).size).toBe(BACKUP_TABLE_NAMES.length);
  });

  it('gives every table a label and at least one primary key column', () => {
    for (const table of BACKUP_TABLES) {
      expect(table.label.length).toBeGreaterThan(0);
      expect(table.pk.length).toBeGreaterThan(0);
    }
  });

  it('orders tasks before datasets so datasets.task_id has a parent', () => {
    expect(positionOf('tasks')).toBeLessThan(positionOf('datasets'));
  });

  it('orders submissions before submission_results so its composite id has a parent', () => {
    expect(positionOf('submissions')).toBeLessThan(positionOf('submission_results'));
  });

  it('orders testcases before evaluations, which references it', () => {
    expect(positionOf('testcases')).toBeLessThan(positionOf('evaluations'));
  });

  it('orders user_test_results before user_test_executables, which references it', () => {
    expect(positionOf('user_test_results')).toBeLessThan(positionOf('user_test_executables'));
  });

  it('places fsobjects last because it carries the large objects', () => {
    expect(positionOf('fsobjects')).toBe(BACKUP_TABLE_NAMES.length - 1);
    expect(BACKUP_TABLES.at(-1)?.needsLargeObjects).toBe(true);
  });
});

describe('schema parity', () => {
  it('gives every catalog table the primary key its schema model declares', () => {
    for (const table of BACKUP_TABLES) {
      expect(SCHEMA_MODELS.get(table.name)?.primaryKey, `model ${table.name} is missing from schema.prisma`).toEqual(table.pk);
    }
  });

  it('accounts for every schema model, so a new table fails the suite until it is placed', () => {
    const uncovered = [...SCHEMA_MODELS.keys()].filter((name) => !BACKUP_TABLE_NAMES.includes(name) && !MODELS_OUTSIDE_CATALOG.has(name));
    expect(uncovered).toEqual([]);
  });

  it('does not exclude a model that schema.prisma no longer declares', () => {
    expect([...MODELS_OUTSIDE_CATALOG].filter((name) => !SCHEMA_MODELS.has(name))).toEqual([]);
  });
});

describe('foreign-key order', () => {
  it('places every catalog parent before its child', () => {
    const outOfOrder: string[] = [];
    for (const [child, model] of SCHEMA_MODELS) {
      if (!BACKUP_TABLE_NAMES.includes(child)) continue;
      for (const parent of model.foreignKeys) {
        if (!BACKUP_TABLE_NAMES.includes(parent)) continue;
        if (UNSATISFIABLE_EDGES.some(([cycleChild, cycleParent]) => cycleChild === child && cycleParent === parent)) continue;
        if (positionOf(parent) >= positionOf(child)) outOfOrder.push(`${parent} before ${child}`);
      }
    }
    expect(outOfOrder).toEqual([]);
  });

  it('exempts only cycle edges that schema.prisma still declares', () => {
    const stale = UNSATISFIABLE_EDGES.filter(([child, parent]) => !SCHEMA_MODELS.get(child)?.foreignKeys.includes(parent));
    expect(stale).toEqual([]);
  });
});

describe('validateTableSelection', () => {
  it('accepts a known subset with no unknown names', () => {
    const result = validateTableSelection(['contests', 'users', 'teams']);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects an empty selection that would dump the entire database', () => {
    const result = validateTableSelection([]);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('-t');
    expect(result.warnings[0]).toContain('entire database');
  });

  it('reports only the unarchived admins for the whole catalog', () => {
    const result = validateTableSelection([...BACKUP_TABLE_NAMES]);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('admins');
  });

  it('rejects a name outside the catalog', () => {
    const result = validateTableSelection(['contests', 'pg_catalog; DROP TABLE admins']);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(['pg_catalog; DROP TABLE admins']);
  });

  it('rejects a shell glob that would widen the selection', () => {
    const result = validateTableSelection(['contests', 'contest*']);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(['contest*']);
  });

  it('deduplicates repeated unknown names', () => {
    const result = validateTableSelection(['nope', 'nope']);
    expect(result.unknown).toEqual(['nope']);
  });

  it('short-circuits every warning while a name is unknown', () => {
    const result = validateTableSelection(['datasets', 'files', 'contest*']);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(['contest*']);
    expect(result.warnings).toEqual([]);
  });

  it('warns that submissions without fsobjects loses its content blobs', () => {
    const result = validateTableSelection([
      'contests',
      'users',
      'teams',
      'tasks',
      'participations',
      'submissions',
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('fsobjects');
  });

  it('warns when a child is selected without its parent', () => {
    const result = validateTableSelection(['datasets']);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('tasks');
  });

  it('names the one missing parent of a multi-parent child', () => {
    const result = validateTableSelection([
      'contests',
      'users',
      'teams',
      'tasks',
      'participations',
      'datasets',
      'submissions',
      'testcases',
      'evaluations',
      'fsobjects',
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('submission_results');
  });

  it('names every missing parent of a child that needs two', () => {
    const result = validateTableSelection(['contests', 'participations']);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('teams');
    expect(result.warnings[0]).toContain('users');
  });

  it('warns about announcements missing contests, and only then', () => {
    expect(missingParentWarnings(validateTableSelection(['contests', 'announcements']).warnings)).toEqual([]);
    const warnings = missingParentWarnings(validateTableSelection(['announcements']).warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('contests');
  });

  it('warns that admins is never archived for every table that holds an admin_id', () => {
    for (const name of ['announcements', 'messages', 'questions']) {
      const result = validateTableSelection([name]);
      expect(result.valid).toBe(true);
      const warning = result.warnings.find((entry) => entry.includes('admins'));
      expect(warning).toContain('admin_id');
      expect(warning).toContain('Epic 3');
    }
  });

  it('warns about fsobjects for whichever flagged consumer is selected', () => {
    const consumers = BACKUP_TABLES.filter((table) => table.needsLargeObjects && table.name !== 'fsobjects');
    expect(consumers.length).toBeGreaterThan(0);
    for (const table of consumers) {
      expect(validateTableSelection([table.name]).warnings.some((warning) => warning.includes('fsobjects'))).toBe(true);
    }
  });

  it('stays silent about large objects once fsobjects is selected', () => {
    const result = validateTableSelection(['contests', 'users', 'teams', 'tasks', 'participations', 'submissions', 'fsobjects']);
    expect(result.warnings).toEqual([]);
  });

  it('stays silent about large objects when no flagged table is selected', () => {
    const result = validateTableSelection(['contests', 'users', 'teams', 'participations']);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});