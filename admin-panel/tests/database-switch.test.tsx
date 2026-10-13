import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ACTIVE_DATABASE_KEY,
  collectRelevantUpdates,
  computeChangedKeys,
  configTomlKeys,
  type EnvConfigSection,
} from '@/components/settings/envConfigSections';
import { EnvSectionCard } from '@/components/settings/EnvSectionCard';

describe('the active database is editable from the settings screen', () => {
  it('reads the active profile with the rest of the database keys', () => {
    expect(configTomlKeys()).toContainEqual({ section: 'core', key: ACTIVE_DATABASE_KEY });
  });

  it('writes the active profile into [core], where config sync resolves it', () => {
    const updates = collectRelevantUpdates('config.toml', {
      'config.toml': { [ACTIVE_DATABASE_KEY]: 'evaluate' },
    });

    expect(updates).toContainEqual({ section: 'core', key: ACTIVE_DATABASE_KEY, value: 'evaluate' });
  });

  it('treats a selection that names the running profile as no change, and a real switch as one', () => {
    const loaded = { 'config.toml': { [ACTIVE_DATABASE_KEY]: 'default' } };
    const same = { 'config.toml': { [ACTIVE_DATABASE_KEY]: 'default' } };
    const switched = { 'config.toml': { [ACTIVE_DATABASE_KEY]: 'evaluate' } };

    expect(computeChangedKeys(same, loaded)).toEqual([]);
    expect(computeChangedKeys(switched, loaded)).toContain(ACTIVE_DATABASE_KEY);
  });
});

describe('the active database control is a selector of the declared profiles', () => {
  const section: EnvConfigSection = {
    title: 'Database Configuration',
    filename: 'config.toml',
    fields: [
      { key: ACTIVE_DATABASE_KEY, tomlSection: 'core', control: 'database-profile', label: 'Active Database Profile' },
      { key: 'POSTGRES_DB', tomlSection: 'core', label: 'Database Name' },
    ],
  };

  it('renders the profile field as a select offering every declared profile', () => {
    const html = renderToStaticMarkup(
      <EnvSectionCard
        section={section}
        data={{ 'config.toml': { [ACTIVE_DATABASE_KEY]: 'default', POSTGRES_DB: 'cmsdb' } }}
        originalData={{ 'config.toml': { [ACTIVE_DATABASE_KEY]: 'default', POSTGRES_DB: 'cmsdb' } }}
        saving={false}
        hasPendingRestarts={false}
        onPersist={async () => undefined}
        onChange={() => undefined}
        databaseProfiles={['default', 'evaluate']}
      />,
    );

    expect(html).toContain('<select');
    expect(html).toContain('>evaluate<');
    // The database name stays a text input, so the selector is scoped to the profile field.
    expect((html.match(/<input/g) ?? []).length).toBe(1);
  });
});

describe('switching the active database recreates the database consumers', () => {
  beforeEach(() => vi.resetModules());

  it('registers ACTIVE_DATABASE as an env trigger for the database and the panel', async () => {
    vi.doMock('@/lib/permissions', () => ({ ensurePermission: vi.fn(async () => {}) }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}) }));
    const { analyzeRestartRequirements } = await import('@/app/actions/services');

    const { requiredRestarts } = await analyzeRestartRequirements([ACTIVE_DATABASE_KEY]);

    expect(requiredRestarts).toContain('cms-database');
    expect(requiredRestarts).toContain('cms-admin-panel-next');
  });
});
