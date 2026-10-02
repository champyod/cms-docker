import { describe, expect, it } from 'vitest';
import { BACKUP_TABLE_NAMES, BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';

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

describe('validateTableSelection', () => {
  it('accepts a known subset with no unknown names', () => {
    const result = validateTableSelection(['contests', 'users', 'teams']);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports no warnings for the whole catalog', () => {
    const result = validateTableSelection([...BACKUP_TABLE_NAMES]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('rejects a name outside the catalog', () => {
    const result = validateTableSelection(['contests', 'pg_catalog; DROP TABLE admins']);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(['pg_catalog; DROP TABLE admins']);
  });

  it('deduplicates repeated unknown names', () => {
    const result = validateTableSelection(['nope', 'nope']);
    expect(result.unknown).toEqual(['nope']);
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
});