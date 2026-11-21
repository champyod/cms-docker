import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ usersFindUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: { users: { findUnique: mocks.usersFindUnique } },
}));

import { prepareRow, readCredentialTemplates } from '@/app/api/users/bulk/bulkRowPreparation';
import {
  MAX_GENERATOR_LENGTH,
  MIN_GENERATOR_LENGTH,
  PASSWORD_CONFIG,
  USERNAME_CONFIG,
  type GeneratorConfig,
} from '@/lib/credential-template';

const NO_GROUPS: GeneratorConfig = {
  length: 8,
  letters: false,
  caseMode: 'both',
  numbers: false,
  specials: false,
  operators: false,
};

const TEMPLATES = {
  username: 'team01',
  password: 'secret*',
  usernameConfig: USERNAME_CONFIG,
  passwordConfig: PASSWORD_CONFIG,
};

const ADA = { first_name: 'Ada', last_name: 'Lovelace' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usersFindUnique.mockResolvedValue(null);
});

describe('bulk row credential templates', () => {
  it('renders both templates for a row that carries neither credential', async () => {
    const prepared = await prepareRow(ADA, 2, { ...TEMPLATES, username: 'camp1*', password: '*' }, 0, new Set());

    expect(prepared).toMatchObject({
      username: expect.stringMatching(/^camp1[A-Za-z0-9]{8}$/),
      plainPassword: expect.stringMatching(/^.{8}$/),
    });
  });

  it('reports a credential the configured alphabet cannot render', async () => {
    const prepared = await prepareRow(
      ADA,
      2,
      { ...TEMPLATES, password: '', passwordConfig: NO_GROUPS },
      0,
      new Set(),
    );

    expect(prepared).toEqual({ rowIndex: 2, reason: 'password is required' });
  });

  it('re-rolls a username the database already holds', async () => {
    mocks.usersFindUnique.mockResolvedValueOnce({ id: 9 });

    const prepared = await prepareRow(ADA, 2, TEMPLATES, 0, new Set());

    expect(prepared).toMatchObject({ username: expect.stringMatching(/^team01[0-9a-f]{4}$/) });
    expect(mocks.usersFindUnique).toHaveBeenCalledTimes(2);
  });

  it('re-rolls a username the batch already holds', async () => {
    const prepared = await prepareRow(ADA, 2, TEMPLATES, 0, new Set(['team01']));

    expect(prepared).toMatchObject({ username: expect.stringMatching(/^team01[0-9a-f]{4}$/) });
  });

  it('keeps an explicit username and password without asking the database', async () => {
    const prepared = await prepareRow({ ...ADA, username: 'ada99', password: 'secret' }, 2, TEMPLATES, 0, new Set());

    expect(prepared).toMatchObject({ username: 'ada99', plainPassword: 'secret', hadExplicitPassword: true });
    expect(mocks.usersFindUnique).not.toHaveBeenCalled();
  });

  it('keeps a template run inside the alphabet the users API accepts', async () => {
    const prepared = await prepareRow(
      ADA,
      2,
      {
        ...TEMPLATES,
        username: '',
        usernameConfig: { ...NO_GROUPS, letters: true, specials: true, operators: true, length: 12 },
      },
      0,
      new Set(),
    );

    expect(prepared).toMatchObject({ username: expect.stringMatching(/^[A-Za-z0-9]{12}$/) });
  });

  it('treats a blank template as one full run of the shipped config', async () => {
    const prepared = await prepareRow(ADA, 2, { ...TEMPLATES, username: '', password: '' }, 0, new Set());

    expect(prepared).toMatchObject({
      username: expect.stringMatching(new RegExp(`^[A-Za-z0-9]{${USERNAME_CONFIG.length}}$`)),
      plainPassword: expect.stringMatching(new RegExp(`^.{${PASSWORD_CONFIG.length}}$`)),
    });
  });
});

describe('credential template payload', () => {
  it('falls back to the shipped configs when the payload carries none', () => {
    expect(readCredentialTemplates(undefined)).toEqual({
      username: '',
      password: '',
      usernameConfig: USERNAME_CONFIG,
      passwordConfig: PASSWORD_CONFIG,
    });
  });

  it('clamps a length the popup never offered back into its bounds', () => {
    const templates = readCredentialTemplates({
      usernameTemplate: 'camp1*',
      passwordTemplate: '*',
      usernameConfig: { length: 5000, letters: true, numbers: false, caseMode: 'lower' },
      passwordConfig: { length: 1 },
    });

    expect(templates).toEqual({
      username: 'camp1*',
      password: '*',
      usernameConfig: {
        ...USERNAME_CONFIG,
        length: MAX_GENERATOR_LENGTH,
        caseMode: 'lower',
        numbers: false,
      },
      passwordConfig: { ...PASSWORD_CONFIG, length: MIN_GENERATOR_LENGTH },
    });
  });

  it('keeps the shipped value for a group the payload leaves out', () => {
    const templates = readCredentialTemplates({ passwordConfig: { length: 'wide', letters: false } });

    expect(templates.passwordConfig).toEqual({ ...PASSWORD_CONFIG, letters: false });
  });

  it('ignores a case mode outside the offered set', () => {
    const templates = readCredentialTemplates({ usernameConfig: { caseMode: 'title' } });

    expect(templates.usernameConfig.caseMode).toBe(USERNAME_CONFIG.caseMode);
  });
});
