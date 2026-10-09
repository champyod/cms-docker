import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMIN_TABLE, BACKUP_TABLE_NAMES, BACKUP_TABLES, GRANT_TABLES, SCHEDULE_TABLE, validateTableSelection } from '@/lib/backup-table-catalog';

const SCHEMA_SOURCE = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');

/**
 * schema.prisma models the catalog leaves out on purpose.
 *
 * `monitor_targets` is infrastructure: it describes which external URLs the
 * panel probes and at which interval, so it is monitor configuration that this
 * host owns rather than competition data it serves. A restore that carried it
 * would repoint the panel's alerting at endpoints the archive happened to name.
 *
 * `audit_log` is the append-only, hash-chained record of what was authorized and
 * by whom. Its rows are only meaningful as the ordered result of real events, so
 * replaying them into a restore would put actions in the trail that never
 * happened, and replaying only part of it would break the chain outright. It is
 * never restored; a restore is written to the trail by the actions it performs,
 * which is the only honest way for it to appear there.
 *
 * Everything else in the schema is selectable: the RBAC grant tables are here
 * because a restore that carried no privileges would land every admin with an
 * empty permission set, which is a panel nobody can operate.
 *
 * The six ranking_* projection tables are excluded for the same reason as
 * `audit_log`: they hold what the proxy pushed to the scoreboard, which is
 * derived from the contests, participations and submissions a restore already
 * carries. Restoring the projection would either duplicate the rebuild or
 * contradict the contest data restored beside it.
 *
 * The two ranking control tables are NOT excluded. The appearance row and the
 * override rows are operator decisions that exist nowhere else, so they belong
 * in the catalog.
 */
const MODELS_OUTSIDE_CATALOG: ReadonlySet<string> = new Set([
  'monitor_targets',
  'audit_log',
  'security_blocks',
  'ranking_contests',
  'ranking_tasks',
  'ranking_teams',
  'ranking_users',
  'ranking_submissions',
  'ranking_subchanges',
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

  it('places admins before every table that names it as the row author', () => {
    for (const child of ['announcements', 'messages', 'questions', 'admin_groups', 'admin_permission_overrides']) {
      expect(positionOf(ADMIN_TABLE)).toBeLessThan(positionOf(child));
    }
  });

  it('orders each grant table after both of its parents', () => {
    expect(positionOf('groups')).toBeLessThan(positionOf('group_permissions'));
    expect(positionOf('permissions')).toBeLessThan(positionOf('group_permissions'));
    expect(positionOf('groups')).toBeLessThan(positionOf('admin_groups'));
    expect(positionOf(ADMIN_TABLE)).toBeLessThan(positionOf('admin_groups'));
    expect(positionOf('permissions')).toBeLessThan(positionOf('admin_permission_overrides'));
    expect(positionOf(ADMIN_TABLE)).toBeLessThan(positionOf('admin_permission_overrides'));
  });

  it('places fsobjects last because it carries the large objects', () => {
    expect(positionOf('fsobjects')).toBe(BACKUP_TABLE_NAMES.length - 1);
    expect(BACKUP_TABLES.at(-1)?.needsLargeObjects).toBe(true);
  });

  it('flags the credential and grant tables sensitive, and nothing else', () => {
    const flagged = BACKUP_TABLES.filter((table) => 'sensitive' in table && table.sensitive).map((table) => table.name);
    // Two kinds of authority table: one holds an account and its password hash, the
    // other holds what that account may do. The ranking console keeps its own
    // accounts, so it joins admins in the first kind rather than the second.
    const credentialTables = [ADMIN_TABLE, 'ranking_console_users'];
    expect(flagged).toEqual([...credentialTables, ...GRANT_TABLES]);
    expect(GRANT_TABLES).toEqual(flagged.filter((name) => !credentialTables.includes(name)));
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

  it('keeps admins, the grant tables and the backup tables out of no exclusion', () => {
    for (const name of [ADMIN_TABLE, ...GRANT_TABLES, SCHEDULE_TABLE, 'backup_runs']) {
      expect(BACKUP_TABLE_NAMES).toContain(name);
      expect(MODELS_OUTSIDE_CATALOG.has(name)).toBe(false);
    }
  });

  it('confirms admins declares no parent of its own, so it is a catalog root', () => {
    expect(SCHEMA_MODELS.get(ADMIN_TABLE)?.foreignKeys).toEqual([]);
  });

  it('confirms backup_runs.scheduleId is a bare scalar with no foreign key', () => {
    expect(SCHEMA_MODELS.get('backup_runs')?.foreignKeys).toEqual([]);
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

  it('reports the sensitivity warnings and nothing else for the whole catalog', () => {
    const result = validateTableSelection([...BACKUP_TABLE_NAMES]);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
    const warned = result.warnings.join('\n');
    expect(warned).toContain(ADMIN_TABLE);
    expect(warned).toContain('admin_groups');
    expect(warned).toContain(SCHEDULE_TABLE);
    expect(missingParentWarnings([...result.warnings])).toEqual([]);
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
    expect(missingParentWarnings(validateTableSelection([ADMIN_TABLE, 'contests', 'announcements']).warnings)).toEqual([]);
    const warnings = missingParentWarnings(validateTableSelection([ADMIN_TABLE, 'announcements']).warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('contests');
  });

  it('warns that a missing admins nulls the reference instead of failing the restore', () => {
    for (const name of ['announcements', 'messages', 'questions']) {
      const warnings = missingParentWarnings(validateTableSelection([name]).warnings);
      const adminWarning = warnings.find((warning) => warning.includes(ADMIN_TABLE));
      expect(adminWarning, `${name} reported no admins warning`).toBeDefined();
      expect(adminWarning).toContain('set to NULL');
      expect(adminWarning).not.toContain('fail its foreign keys');
    }
  });

  it('warns about both grant parents of a grant table selected alone', () => {
    const result = validateTableSelection(['admin_groups']);
    expect(result.valid).toBe(true);
    const warnings = missingParentWarnings(result.warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(ADMIN_TABLE);
    expect(warnings[0]).toContain('groups');
  });

  it('stays silent about grant parents once both are selected', () => {
    const result = validateTableSelection([ADMIN_TABLE, 'groups', 'admin_groups']);
    expect(missingParentWarnings(result.warnings)).toEqual([]);
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

describe('sensitivity warnings', () => {
  it('says admins carries login hashes and rewrites the username, hash and enabled flag', () => {
    const warning = validateTableSelection([ADMIN_TABLE]).warnings.find((entry) => entry.includes(ADMIN_TABLE));
    expect(warning).toContain('password hash');
    expect(warning).toContain('username');
    expect(warning).toContain('enabled');
  });

  it('says privileges travel only when the grant tables are co-selected', () => {
    const alone = validateTableSelection([ADMIN_TABLE]).warnings.find((entry) => entry.includes(ADMIN_TABLE));
    expect(alone).toContain('none are restored');
    expect(alone).toContain('empty database has none at all');
    const withGrants = validateTableSelection([ADMIN_TABLE, ...GRANT_TABLES]).warnings.find((entry) => entry.includes(ADMIN_TABLE));
    expect(withGrants).toContain('Privileges do travel');
    expect(withGrants).toContain('admin_groups');
  });

  it('names every selected grant table and points at the validate report', () => {
    const result = validateTableSelection([...GRANT_TABLES]);
    const warning = result.warnings.find((entry) => entry.includes('who may act'));
    expect(warning).toBeDefined();
    for (const table of GRANT_TABLES) expect(warning).toContain(`"${table}"`);
    expect(warning).toContain('validate report');
  });

  it('says a restored enabled schedule resumes firing under the poller', () => {
    const result = validateTableSelection([SCHEDULE_TABLE]);
    expect(result.valid).toBe(true);
    const warning = result.warnings.find((entry) => entry.includes(SCHEDULE_TABLE));
    expect(warning).toContain('resumes firing');
    expect(warning).toContain('interval');
  });

  it('says nothing about privilege while no sensitive table is selected', () => {
    const result = validateTableSelection(['contests', 'users', 'teams']);
    expect(result.warnings.join(' ')).not.toContain('who may act');
  });
});