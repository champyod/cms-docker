import { describe, expect, it } from 'vitest';

import type { SelectedUser } from '@/components/users/bulkEditActions';
import { collectCredentialUpdates, regenerateCredentials } from '@/components/users/bulkEditActions';
import type { CredentialTemplates } from '@/components/users/csvPreview';
import { countUnreachableSelection } from '@/components/users/useUserSelection';
import { PASSWORD_CONFIG, USERNAME_CONFIG, type GeneratorConfig } from '@/lib/credential-template';

function selectedUser(id: number, username: string): SelectedUser {
  return { id, first_name: `First${id}`, last_name: 'Last', username, password: null };
}

const DIGITS: GeneratorConfig = {
  length: 4,
  letters: false,
  caseMode: 'both',
  numbers: true,
  specials: false,
  operators: false,
};

function templates(overrides: Partial<CredentialTemplates> = {}): CredentialTemplates {
  return {
    username: 'camp1*',
    password: 'pass*',
    usernameConfig: USERNAME_CONFIG,
    passwordConfig: PASSWORD_CONFIG,
    ...overrides,
  };
}

describe('bulk credential change collection', () => {
  it('sends nothing when the selection is untouched, so apply performs no write', () => {
    const baseline = [selectedUser(1, 'alice'), selectedUser(2, 'bob')];

    expect(collectCredentialUpdates(baseline, baseline)).toEqual([]);
  });

  it('sends only the row whose username was regenerated', () => {
    const baseline = [selectedUser(1, 'alice'), selectedUser(2, 'bob')];
    const rows = [selectedUser(1, 'alice'), { ...selectedUser(2, 'bob'), username: 'bobx9f2' }];

    expect(collectCredentialUpdates(rows, baseline)).toEqual([{ id: 2, username: 'bobx9f2', password: null }]);
  });

  it('carries a regenerated password for the row that has one', () => {
    const baseline = [selectedUser(1, 'alice'), selectedUser(2, 'bob')];
    const rows = [selectedUser(1, 'alice'), { ...selectedUser(2, 'bob'), password: 'freshSecret' }];

    expect(collectCredentialUpdates(rows, baseline)).toEqual([{ id: 2, username: 'bob', password: 'freshSecret' }]);
  });

  it('ignores a row the baseline never held and that has no password to save', () => {
    const baseline = [selectedUser(1, 'alice')];

    expect(collectCredentialUpdates([...baseline, selectedUser(9, 'ghost')], baseline)).toEqual([]);
  });
});

describe('bulk edit credential templates', () => {
  it('renders the username template and leaves the password untouched', () => {
    const [row] = regenerateCredentials([selectedUser(1, 'alice')], 'username', templates());

    expect(row.username).toMatch(/^camp1[A-Za-z0-9]{8}$/);
    expect(row.password).toBeNull();
  });

  it('keeps the username run to the alphabet the users API accepts, whatever the config asks for', () => {
    const withSymbols: GeneratorConfig = { ...DIGITS, letters: true, specials: true, operators: true, length: 12 };

    const [row] = regenerateCredentials([selectedUser(1, 'alice')], 'username', templates({ usernameConfig: withSymbols }));

    expect(row.username).toMatch(/^camp1[A-Za-z0-9]{12}$/);
  });

  it('treats a blank username template as one full random run', () => {
    const [row] = regenerateCredentials([selectedUser(1, 'alice')], 'username', templates({ username: '' }));

    expect(row.username).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it('re-rolls a username the batch already holds, so two rows cannot share a name', () => {
    const rows = regenerateCredentials(
      [selectedUser(1, 'alice'), selectedUser(2, 'bob')],
      'username',
      templates({ username: 'team01' }),
    );

    expect(rows[0].username).toBe('team01');
    expect(rows[1].username).toMatch(/^team01[A-Za-z0-9]{4}$/);
  });

  it('renders the password template and leaves the username untouched', () => {
    const [row] = regenerateCredentials([selectedUser(1, 'alice')], 'password', templates({ password: 'pass*', passwordConfig: DIGITS }));

    expect(row.password).toMatch(/^pass[0-9]{4}$/);
    expect(row.username).toBe('alice');
  });

  it('gives each wildcard its own run', () => {
    const [row] = regenerateCredentials([selectedUser(1, 'alice')], 'password', templates({ password: '*_*', passwordConfig: DIGITS }));

    expect(row.password).toMatch(/^[0-9]{4}_[0-9]{4}$/);
  });
});

describe('unreachable selection counting', () => {
  it('reports selected ids that no fetched page could resolve', () => {
    expect(countUnreachableSelection(3, 2)).toBe(1);
    expect(countUnreachableSelection(2, 2)).toBe(0);
  });

  it('never reports a negative count when the cache holds more rows than the selection', () => {
    expect(countUnreachableSelection(1, 4)).toBe(0);
  });
});
