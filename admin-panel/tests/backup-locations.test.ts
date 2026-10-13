import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getBackupRoot } from '@/lib/backup-archives';
import {
  SYSTEM_LOCATION_ID,
  findDefaultLocation,
  listBackupLocations,
  resolveReadRoot,
  resolveWriteRoot,
} from '@/lib/backup-locations';

const SYSTEM = { id: SYSTEM_LOCATION_ID, label: 'Primary volume', path: '' };

const originalBackupDir = process.env.BACKUP_DIR;

beforeEach(() => {
  delete process.env.BACKUP_DIR;
});

afterEach(() => {
  if (originalBackupDir === undefined) delete process.env.BACKUP_DIR;
  else process.env.BACKUP_DIR = originalBackupDir;
});

describe('the one backup location', () => {
  it('lists exactly the system location', async () => {
    expect(await listBackupLocations()).toEqual([SYSTEM]);
  });

  it('defaults to the system location', async () => {
    expect(await findDefaultLocation()).toEqual(SYSTEM);
  });
});

describe('resolveReadRoot', () => {
  it('reads the mounted tree for an absent or system id', async () => {
    expect(await resolveReadRoot()).toEqual({ ok: true, root: getBackupRoot() });
    expect(await resolveReadRoot(null)).toEqual({ ok: true, root: getBackupRoot() });
    expect(await resolveReadRoot(SYSTEM_LOCATION_ID)).toEqual({ ok: true, root: getBackupRoot() });
  });

  it('fails closed on an unknown id rather than redirecting', async () => {
    const resolved = await resolveReadRoot('ghost');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('ghost');
  });
});

describe('resolveWriteRoot', () => {
  it('maps every known id to no --root flag', async () => {
    expect(await resolveWriteRoot()).toEqual({ ok: true, root: null });
    expect(await resolveWriteRoot(null)).toEqual({ ok: true, root: null });
    expect(await resolveWriteRoot(SYSTEM_LOCATION_ID)).toEqual({ ok: true, root: null });
  });

  it('fails closed on an unknown id rather than falling back', async () => {
    const resolved = await resolveWriteRoot('ghost');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('ghost');
  });
});
