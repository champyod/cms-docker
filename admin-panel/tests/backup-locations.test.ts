import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBackupRoot } from '@/lib/backup-archives';
import {
  findDefaultLocation,
  listBackupLocations,
  resolveReadRoot,
  resolveWriteRoot,
} from '@/lib/backup-locations';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { backup_locations: { findMany: mocks.findMany, findFirst: mocks.findFirst, findUnique: mocks.findUnique } },
}));

const originalBackupDir = process.env.BACKUP_DIR;

beforeEach(() => {
  delete process.env.BACKUP_DIR;
  mocks.findMany.mockReset();
  mocks.findFirst.mockReset();
  mocks.findUnique.mockReset();
});

afterEach(() => {
  if (originalBackupDir === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = originalBackupDir;
});

/** A backup_locations row; only the three columns the resolver reads are set. */
function row(overrides: Partial<{ id: string; label: string; path: string }> = {}) {
  return { id: 'default', label: 'Primary volume', path: '', ...overrides };
}

describe('listBackupLocations', () => {
  it('queries every row, the system row first', async () => {
    mocks.findMany.mockResolvedValue([
      row(),
      row({ id: 'offsite', label: 'Offsite mirror', path: '/mnt/offsite/cms-backups' }),
    ]);
    const locations = await listBackupLocations();
    expect(mocks.findMany).toHaveBeenCalledWith({ orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }] });
    expect(locations).toEqual([
      { id: 'default', label: 'Primary volume', path: '' },
      { id: 'offsite', label: 'Offsite mirror', path: '/mnt/offsite/cms-backups' },
    ]);
  });
});

describe('findDefaultLocation', () => {
  it('returns the system row', async () => {
    mocks.findFirst.mockResolvedValue(row());
    expect(await findDefaultLocation()).toEqual({ id: 'default', label: 'Primary volume', path: '' });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { isSystem: true } });
  });

  it('returns null when no system row exists', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await findDefaultLocation()).toBeNull();
  });
});

describe('resolveReadRoot', () => {
  it('reads the legacy tree for an absent id through the system row', async () => {
    mocks.findFirst.mockResolvedValue(row());
    expect(await resolveReadRoot()).toEqual({ ok: true, root: getBackupRoot() });
    expect(await resolveReadRoot(null)).toEqual({ ok: true, root: getBackupRoot() });
  });

  it('reads the tree a named absolute path configures', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'offsite', label: 'Offsite mirror', path: '/mnt/offsite/cms-backups' }));
    expect(await resolveReadRoot('offsite')).toEqual({ ok: true, root: '/mnt/offsite/cms-backups' });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'offsite' } });
  });

  it('resolves a relative path that names the legacy tree against the repo root', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'legacy', label: 'Legacy spelling', path: 'backups' }));
    expect(await resolveReadRoot('legacy')).toEqual({ ok: true, root: getBackupRoot() });
  });

  it('fails closed on an id no row carries', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const resolved = await resolveReadRoot('ghost');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('ghost');
  });

  it('fails closed on an absent id when no system row exists', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const resolved = await resolveReadRoot();
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('default');
  });

  it('fails closed on a relative path that names a tree only one container sees', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'drift', label: 'Drifted', path: './elsewhere' }));
    const resolved = await resolveReadRoot('drift');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('only one container sees');
  });
});

describe('resolveWriteRoot', () => {
  it('maps the system row to no --root flag', async () => {
    mocks.findFirst.mockResolvedValue(row());
    expect(await resolveWriteRoot()).toEqual({ ok: true, root: null });
    expect(await resolveWriteRoot(null)).toEqual({ ok: true, root: null });
  });

  it('maps a configured path equal to the backup root to no --root flag', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'same', label: 'Same tree', path: getBackupRoot() }));
    expect(await resolveWriteRoot('same')).toEqual({ ok: true, root: null });
  });

  it('passes an absolute path that is not the backup root through verbatim', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'offsite', label: 'Offsite mirror', path: '/mnt/offsite/cms-backups' }));
    expect(await resolveWriteRoot('offsite')).toEqual({ ok: true, root: '/mnt/offsite/cms-backups' });
  });

  it('maps a relative path naming the legacy tree to no --root flag', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'legacy', label: 'Legacy spelling', path: 'backups' }));
    expect(await resolveWriteRoot('legacy')).toEqual({ ok: true, root: null });
  });

  it('fails closed on an unknown id instead of falling back to the default tree', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const resolved = await resolveWriteRoot('ghost');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('ghost');
  });

  it('fails closed on a relative path that names a tree only one container sees', async () => {
    mocks.findUnique.mockResolvedValue(row({ id: 'drift', label: 'Drifted', path: './elsewhere' }));
    const resolved = await resolveWriteRoot('drift');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('only one container sees');
  });
});
