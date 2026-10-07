import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultLocationId,
  listBackupLocations,
  parseBackupLocations,
  resolveDefaultLocationId,
  resolveReadRoot,
  resolveWriteRoot,
} from '@/lib/backup-locations';
import { getBackupRoot } from '@/lib/backup-archives';

const VALID_LIST = JSON.stringify([
  { id: 'default', label: 'Primary volume', path: './backups' },
  { id: 'secondary', label: 'Offsite mirror', path: '/mnt/offsite/cms-backups' },
]);

const originalEnv = {
  BACKUP_DIR: process.env.BACKUP_DIR,
  BACKUP_LOCATIONS: process.env.BACKUP_LOCATIONS,
  BACKUP_DEFAULT_LOCATION: process.env.BACKUP_DEFAULT_LOCATION,
};

function setEnv(key: 'BACKUP_DIR' | 'BACKUP_LOCATIONS' | 'BACKUP_DEFAULT_LOCATION', value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_LOCATIONS;
  delete process.env.BACKUP_DEFAULT_LOCATION;
});

afterEach(() => {
  (Object.keys(originalEnv) as Array<keyof typeof originalEnv>).forEach((key) => setEnv(key, originalEnv[key]));
});

describe('parseBackupLocations', () => {
  it('accepts a relative default tree paired with an absolute second location', () => {
    expect(parseBackupLocations(VALID_LIST)).toEqual([
      { id: 'default', label: 'Primary volume', path: './backups' },
      { id: 'secondary', label: 'Offsite mirror', path: '/mnt/offsite/cms-backups' },
    ]);
  });

  it('trims labels and paths', () => {
    const parsed = parseBackupLocations('[{"id":"a","label":"  Pad  ","path":" /srv/backups "}]');
    expect(parsed).toEqual([{ id: 'a', label: 'Pad', path: '/srv/backups' }]);
  });

  it('rejects malformed JSON', () => {
    expect(parseBackupLocations('{not json')).toBeNull();
  });

  it('rejects a non-array payload', () => {
    expect(parseBackupLocations('{"id":"default"}')).toBeNull();
  });

  it('rejects an empty list so the caller falls back to the implicit default', () => {
    expect(parseBackupLocations('[]')).toBeNull();
  });

  it('rejects a list above the size cap', () => {
    const entries = Array.from({ length: 17 }, (_, index) => ({ id: `loc${index}`, label: 'x', path: `/srv/${index}` }));
    expect(parseBackupLocations(JSON.stringify(entries))).toBeNull();
  });

  it('rejects duplicate ids rather than keeping the first or last', () => {
    const raw = JSON.stringify([
      { id: 'default', label: 'One', path: './backups' },
      { id: 'default', label: 'Two', path: '/srv/other' },
    ]);
    expect(parseBackupLocations(raw)).toBeNull();
  });

  it.each([['../escape'], ['has space'], [''], ['-leading'], ['sl/ash']])('rejects malformed id %p', (id) => {
    const raw = JSON.stringify([{ id, label: 'x', path: '/srv/backups' }]);
    expect(parseBackupLocations(raw)).toBeNull();
  });

  it('rejects a blank label or blank path', () => {
    expect(parseBackupLocations('[{"id":"a","label":"  ","path":"/srv"}]')).toBeNull();
    expect(parseBackupLocations('[{"id":"a","label":"x","path":" "}]')).toBeNull();
  });

  it('rejects a non-string field wherever it appears', () => {
    expect(parseBackupLocations('[{"id":1,"label":"x","path":"/srv"}]')).toBeNull();
    expect(parseBackupLocations('[{"id":"a","label":"x","path":null}]')).toBeNull();
  });

  it('rejects a relative path that is not the default backup tree', () => {
    expect(parseBackupLocations('[{"id":"x","label":"Off","path":"./elsewhere"}]')).toBeNull();
  });

  it('accepts a relative path that resolves to the default backup tree under any spelling', () => {
    const raw = JSON.stringify([{ id: 'default', label: 'Primary', path: 'backups/' }]);
    expect(parseBackupLocations(raw)).not.toBeNull();
  });

  it('rejects a path resolving to the tree when BACKUP_DIR points elsewhere', () => {
    process.env.BACKUP_DIR = '/var/lib/cms-backups';
    expect(parseBackupLocations('[{"id":"default","label":"Primary","path":"./backups"}]')).toBeNull();
  });
});

describe('listBackupLocations', () => {
  it('yields one implicit default rooted at getBackupRoot() when env is absent', () => {
    expect(listBackupLocations()).toEqual([
      { id: 'default', label: 'Primary volume', path: getBackupRoot() },
    ]);
  });

  it('falls back to the implicit default when the configured list is invalid', () => {
    process.env.BACKUP_LOCATIONS = '[{"id":"broken"}]';
    expect(listBackupLocations()).toHaveLength(1);
    expect(listBackupLocations()[0]?.id).toBe('default');
  });

  it('returns the parsed list when the env is valid', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    expect(listBackupLocations().map((location) => location.id)).toEqual(['default', 'secondary']);
  });
});

describe('listBackupLocations id lookup', () => {
  it('finds a configured id and reports an unknown one as null', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    const locations = listBackupLocations();
    expect(locations.find((location) => location.id === 'secondary')?.label).toBe('Offsite mirror');
    expect(locations.find((location) => location.id === 'nope')).toBeUndefined();
  });
});

describe('getDefaultLocationId and resolveDefaultLocationId', () => {
  it('reads BACKUP_DEFAULT_LOCATION and defaults to default', () => {
    expect(getDefaultLocationId()).toBe('default');
    process.env.BACKUP_DEFAULT_LOCATION = 'secondary';
    expect(getDefaultLocationId()).toBe('secondary');
  });

  it('prefers the configured default when the list carries it', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    process.env.BACKUP_DEFAULT_LOCATION = 'secondary';
    expect(resolveDefaultLocationId(listBackupLocations())).toBe('secondary');
  });

  it('falls back to the first entry when the configured default is not in the list', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    process.env.BACKUP_DEFAULT_LOCATION = 'absent';
    expect(resolveDefaultLocationId(listBackupLocations())).toBe('default');
  });

  it('never returns an id the list lacks even for an empty list', () => {
    process.env.BACKUP_DEFAULT_LOCATION = 'absent';
    expect(resolveDefaultLocationId([])).toBe('default');
  });
});

describe('resolveReadRoot', () => {
  it('keeps an absent id on the legacy default root', () => {
    expect(resolveReadRoot()).toEqual({ ok: true, root: getBackupRoot() });
    expect(resolveReadRoot(null)).toEqual({ ok: true, root: getBackupRoot() });
  });

  it('resolves a relative configured path against the repo root', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    const resolved = resolveReadRoot('default');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.root.endsWith('/backups')).toBe(true);
  });

  it('passes an absolute configured path through', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    expect(resolveReadRoot('secondary')).toEqual({ ok: true, root: '/mnt/offsite/cms-backups' });
  });

  it('fails closed on an id the list does not carry', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    const resolved = resolveReadRoot('ghost');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('ghost');
  });

  it('fails closed on an id while the configured list itself is invalid', () => {
    process.env.BACKUP_LOCATIONS = 'not json';
    expect(resolveReadRoot('secondary').ok).toBe(false);
  });

  it('resolves a null id through the configured default location', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    expect(resolveReadRoot(null)).toEqual(resolveReadRoot('default'));
  });

  it('follows BACKUP_DEFAULT_LOCATION when it names a different entry', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    process.env.BACKUP_DEFAULT_LOCATION = 'secondary';
    expect(resolveReadRoot(null)).toEqual({ ok: true, root: '/mnt/offsite/cms-backups' });
  });
});

describe('resolveWriteRoot', () => {
  it('maps an absent id to no --root flag', () => {
    expect(resolveWriteRoot()).toEqual({ ok: true, root: null });
    expect(resolveWriteRoot(null)).toEqual({ ok: true, root: null });
  });

  it('maps the default tree to no --root flag in every spelling', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    expect(resolveWriteRoot('default')).toEqual({ ok: true, root: null });
    process.env.BACKUP_LOCATIONS = JSON.stringify([{ id: 'default', label: 'Primary', path: getBackupRoot() }]);
    expect(resolveWriteRoot('default')).toEqual({ ok: true, root: null });
  });

  it('passes an absolute non-default path through for the monitor', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    expect(resolveWriteRoot('secondary')).toEqual({ ok: true, root: '/mnt/offsite/cms-backups' });
  });

  it('fails closed on an unknown id instead of falling back to the default tree', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    const resolved = resolveWriteRoot('ghost');
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error).toContain('ghost');
  });

  it('sends a null id to whatever the configured default names', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    process.env.BACKUP_DEFAULT_LOCATION = 'secondary';
    expect(resolveWriteRoot(null)).toEqual({ ok: true, root: '/mnt/offsite/cms-backups' });
  });

  it('keeps a null id on no --root flag when the default is the legacy tree', () => {
    process.env.BACKUP_LOCATIONS = VALID_LIST;
    expect(resolveWriteRoot(null)).toEqual({ ok: true, root: null });
  });
});
