import { describe, expect, it } from 'vitest';

import {
  applyConfigTomlUpdates,
  buildConfigTomlUpdates,
  extractConfigTomlValues,
  isConfigTomlSection,
  isValidConfigKey,
  type ConfigTomlKey,
} from '@/lib/config-toml';

// Shaped like the real file: WAF_ENABLED exists in two sections, so a section-agnostic
// writer would have to pick one of them arbitrarily.
const TOML = [
  '# config.toml — single source of truth',
  '',
  '[core]',
  'POSTGRES_DB = "cmsdb"           # str',
  '',
  '[admin]',
  'WAF_ENABLED = 0',
  '',
  '[infra]',
  'WAF_ENABLED = 0',
  'BACKUP_MAX_COUNT = 50',
  '',
].join('\n');

describe('applyConfigTomlUpdates', () => {
  it('writes into the named section, not the first key of that name', () => {
    const updated = applyConfigTomlUpdates(TOML, [
      { section: 'infra', key: 'WAF_ENABLED', value: '1' },
    ]);

    expect(extractConfigTomlValues(updated, [{ section: 'admin', key: 'WAF_ENABLED' }])).toEqual({
      WAF_ENABLED: '0',
    });
    expect(extractConfigTomlValues(updated, [{ section: 'infra', key: 'WAF_ENABLED' }])).toEqual({
      WAF_ENABLED: '1',
    });
  });

  it('leaves every other line of the file untouched', () => {
    const updated = applyConfigTomlUpdates(TOML, [
      { section: 'infra', key: 'BACKUP_MAX_COUNT', value: '25' },
    ]);

    expect(updated).toContain('# config.toml — single source of truth');
    expect(updated).toContain('POSTGRES_DB = "cmsdb"           # str');
    expect(updated).toContain('BACKUP_MAX_COUNT = "25"');
  });

  it('inserts a key the section does not have yet', () => {
    const updated = applyConfigTomlUpdates(TOML, [
      { section: 'infra', key: 'BACKUP_MAX_AGE_DAYS', value: '10' },
    ]);

    expect(extractConfigTomlValues(updated, [{ section: 'infra', key: 'BACKUP_MAX_AGE_DAYS' }])).toEqual({
      BACKUP_MAX_AGE_DAYS: '10',
    });
    expect(extractConfigTomlValues(updated, [{ section: 'infra', key: 'BACKUP_MAX_COUNT' }])).toEqual({
      BACKUP_MAX_COUNT: '50',
    });
  });

  it('keeps a multi-line value on the single line a TOML key can hold', () => {
    const updated = applyConfigTomlUpdates(TOML, [
      { section: 'core', key: 'POSTGRES_DB', value: 'first\nsecond' },
    ]);

    expect(updated).toContain('POSTGRES_DB = "first second"');
    expect(extractConfigTomlValues(updated, [{ section: 'core', key: 'POSTGRES_DB' }])).toEqual({
      POSTGRES_DB: 'first second',
    });
  });

  it('round-trips the value it was given', () => {
    const updated = applyConfigTomlUpdates(TOML, [
      { section: 'admin', key: 'WAF_ENABLED', value: '1' },
    ]);

    expect(extractConfigTomlValues(updated, [{ section: 'admin', key: 'WAF_ENABLED' }])).toEqual({
      WAF_ENABLED: '1',
    });
  });
});

describe('extractConfigTomlValues', () => {
  it('reports an absent key as empty', () => {
    expect(extractConfigTomlValues(TOML, [{ section: 'core', key: 'RANKING_USERNAME' }])).toEqual({
      RANKING_USERNAME: '',
    });
  });

  it('does not pick up a key of the same name from another section', () => {
    expect(extractConfigTomlValues('[core]\nCONTEST_ID = 5\n', [
      { section: 'contest', key: 'CONTEST_ID' },
    ])).toEqual({ CONTEST_ID: '' });
  });
});

describe('buildConfigTomlUpdates', () => {
  const KEYS: readonly ConfigTomlKey[] = [
    { section: 'infra', key: 'BACKUP_MAX_COUNT' },
    { section: 'infra', key: 'BACKUP_INTERVAL_MINS' },
  ];

  it('pairs the values the screen holds with their section', () => {
    expect(buildConfigTomlUpdates({ BACKUP_MAX_COUNT: '25' }, KEYS)).toEqual([
      { section: 'infra', key: 'BACKUP_MAX_COUNT', value: '25' },
    ]);
  });

  it('omits keys the screen never loaded', () => {
    expect(buildConfigTomlUpdates({}, KEYS)).toEqual([]);
  });
});

describe('config.toml guards', () => {
  it('accepts the sections the generator parses', () => {
    expect(isConfigTomlSection('core')).toBe(true);
    expect(isConfigTomlSection('contest')).toBe(true);
  });

  it('rejects a section name that would be appended as a new block', () => {
    expect(isConfigTomlSection('core.infras')).toBe(false);
    expect(isConfigTomlSection('[core]')).toBe(false);
  });

  it('accepts only bare config keys', () => {
    expect(isValidConfigKey('POSTGRES_PASSWORD')).toBe(true);
    expect(isValidConfigKey('2FA_ENABLED')).toBe(false);
    expect(isValidConfigKey('A B')).toBe(false);
    expect(isValidConfigKey('A=B')).toBe(false);
  });
});
