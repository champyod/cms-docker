import { describe, expect, it } from 'vitest';

import { computeChangedKeys, updateFileValue, type EnvFilesData } from '@/components/settings/envConfigSections';

const FILE = 'config.toml';
const loaded: EnvFilesData = { [FILE]: { POSTGRES_DB: 'cmsdb', ADMIN_LISTEN_PORT: '3000' } };

// Why the baseline is shared rather than cloned: the dirty check compares against it by
// value, so it only stays correct while every writer replaces objects instead of
// mutating them. A writer that mutates in place would silently report no unsaved changes.
describe('env config snapshot with a shared baseline', () => {
  it('reports no changes while the baseline and the form are the same object', () => {
    expect(computeChangedKeys(loaded, loaded)).toEqual([]);
  });

  it('detects an edit when the baseline shares its objects with the form', () => {
    const edited = updateFileValue(loaded, FILE, 'ADMIN_LISTEN_PORT', '8080');

    expect(computeChangedKeys(edited, loaded)).toEqual(['ADMIN_LISTEN_PORT']);
  });

  it('leaves the baseline object untouched by an edit', () => {
    const baseline = loaded;
    const edited = updateFileValue(loaded, FILE, 'POSTGRES_DB', 'otherdb');

    expect(baseline[FILE].POSTGRES_DB).toBe('cmsdb');
    expect(edited[FILE].POSTGRES_DB).toBe('otherdb');
    expect(edited).not.toBe(loaded);
    expect(edited[FILE]).not.toBe(loaded[FILE]);
  });

  it('stops reporting a key once the edit is folded back into the baseline', () => {
    const edited = updateFileValue(loaded, FILE, 'POSTGRES_DB', 'otherdb');
    const acknowledged = { ...loaded, [FILE]: { ...loaded[FILE], POSTGRES_DB: 'otherdb' } };

    expect(computeChangedKeys(edited, acknowledged)).toEqual([]);
  });
});
