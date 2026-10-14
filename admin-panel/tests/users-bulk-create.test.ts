import { describe, expect, it } from 'vitest';

import {
  blockingRowIndices,
  buildConfirmLabel,
  countSelectedBlocking,
  isPreviewStale,
  selectableRowIndices,
  selectSubmittableRows,
} from '@/components/users/bulkCreateState';
import {
  buildPreviewRows,
  fillRowCredentials,
  type CredentialTemplates,
  type PreviewRow,
} from '@/components/users/csvPreview';
import { PASSWORD_CONFIG, USERNAME_CONFIG, type GeneratorConfig } from '@/lib/credential-template';

function previewRow(rowIndex: number, issues: string[] = []): PreviewRow {
  return {
    rowIndex,
    first_name: `First${rowIndex}`,
    last_name: 'Last',
    username: `user${rowIndex}`,
    password: 'secret',
    email: '',
    timezone: '',
    team: '',
    issues,
  };
}

const DIGITS: GeneratorConfig = {
  length: 4,
  letters: false,
  caseMode: 'both',
  numbers: true,
  specials: false,
  operators: false,
};

const NO_GROUPS: GeneratorConfig = { ...DIGITS, numbers: false };

function templates(overrides: Partial<CredentialTemplates> = {}): CredentialTemplates {
  return {
    username: 'camp1*',
    password: 'pass*',
    usernameConfig: USERNAME_CONFIG,
    passwordConfig: PASSWORD_CONFIG,
    ...overrides,
  };
}

function emptyRow(rowIndex: number): PreviewRow {
  return { ...previewRow(rowIndex), username: '', password: '' };
}

describe('bulk create selection gating', () => {
  it('creates only the checked rows, in preview order', () => {
    const rows = [previewRow(2), previewRow(3), previewRow(4)];

    const submittable = selectSubmittableRows(rows, new Set([2, 4]), false, new Set());

    expect(submittable.map((row) => row.rowIndex)).toEqual([2, 4]);
  });

  it('selects every parsed row after a parse so nothing is dropped by default', () => {
    const rows = [previewRow(2), previewRow(3)];

    expect([...selectableRowIndices(rows)]).toEqual([2, 3]);
  });

  it('counts a selected invalid row as blocking and names it', () => {
    const rows = [previewRow(2), previewRow(3, ['username missing'])];
    const blocking = blockingRowIndices(rows);

    expect([...blocking]).toEqual([3]);
    expect(countSelectedBlocking(rows, new Set([2, 3]), blocking)).toBe(1);
  });

  it('keeps an invalid row in the create set until it is explicitly skipped', () => {
    const rows = [previewRow(2), previewRow(3, ['username missing'])];
    const blocking = blockingRowIndices(rows);
    const selected = new Set([2, 3]);

    expect(selectSubmittableRows(rows, selected, false, blocking).map((row) => row.rowIndex)).toEqual([2, 3]);
    expect(selectSubmittableRows(rows, selected, true, blocking).map((row) => row.rowIndex)).toEqual([2]);
  });

  it('treats a row whose issues are only a field-count mismatch as blocking', () => {
    const rows = [previewRow(2, ['Row 2: expected 4 fields, got 2'])];

    expect(countSelectedBlocking(rows, new Set([2]), blockingRowIndices(rows))).toBe(1);
  });
});

describe('bulk create stale preview guard', () => {
  it('reports a draft that no longer matches the parsed text', () => {
    expect(isPreviewStale('a,b\n1,2', 'a,b\n1,2')).toBe(false);
    expect(isPreviewStale('a,b\n1,2\n3,4', 'a,b\n1,2')).toBe(true);
  });
});

describe('bulk create confirm label', () => {
  it('names how much of the parsed draft will be created', () => {
    expect(buildConfirmLabel(false, 3, 5)).toBe('Create 3 of 5 users');
  });

  it('falls back to the plain label before anything is parsed', () => {
    expect(buildConfirmLabel(false, 0, 0)).toBe('Create Users from Preview');
  });

  it('asks for a re-parse while the draft has moved on', () => {
    expect(buildConfirmLabel(true, 3, 5)).toBe('Re-parse to continue');
  });
});

describe('bulk create credential templates', () => {
  it('renders a template run into an empty credential', () => {
    const filled = fillRowCredentials(emptyRow(2), templates(), new Set());

    expect(filled.username).toMatch(/^camp1[A-Za-z0-9]{8}$/);
    expect(filled.password).toMatch(/^pass/);
    expect(filled.password).toHaveLength(12);
    expect(filled.issues).toEqual([]);
  });

  it('treats a blank template as one full run', () => {
    const filled = fillRowCredentials(
      emptyRow(2),
      templates({ username: '', password: '', passwordConfig: DIGITS }),
      new Set(),
    );

    expect(filled.username).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(filled.password).toMatch(/^[0-9]{4}$/);
  });

  it('gives each wildcard its own run', () => {
    const filled = fillRowCredentials(
      emptyRow(2),
      templates({ password: '*_*', passwordConfig: DIGITS }),
      new Set(),
    );

    expect(filled.password).toMatch(/^[0-9]{4}_[0-9]{4}$/);
  });

  it('keeps a credential the CSV already carries and counts its username as used', () => {
    const used = new Set<string>();
    const filled = fillRowCredentials(previewRow(2), templates(), used);

    expect(filled.username).toBe('user2');
    expect(filled.password).toBe('secret');
    expect(used.has('user2')).toBe(true);
  });

  it('re-rolls a username the batch already holds', () => {
    const used = new Set(['team01']);
    const filled = fillRowCredentials(emptyRow(2), templates({ username: 'team01' }), used);

    expect(filled.username).toMatch(/^team01[0-9a-z]{4}$/);
    expect(used.has(filled.username)).toBe(true);
  });

  it('keeps a username to the characters the users API accepts', () => {
    const withSymbols: GeneratorConfig = { ...DIGITS, letters: true, specials: true, operators: true, length: 12 };
    const filled = fillRowCredentials(emptyRow(2), templates({ usernameConfig: withSymbols }), new Set());

    expect(filled.username).toMatch(/^camp1[A-Za-z0-9]{12}$/);
  });

  it('leaves the credential missing when the configured alphabet renders nothing', () => {
    const filled = fillRowCredentials(emptyRow(2), templates({ password: '', passwordConfig: NO_GROUPS }), new Set());

    expect(filled.password).toBe('');
    expect(filled.issues).toContain('password missing');
  });

  it('parses without inventing a credential', () => {
    const { rows } = buildPreviewRows('first_name,last_name\nAda,Lovelace\n');

    expect(rows[0].username).toBe('');
    expect(rows[0].password).toBe('');
    expect(rows[0].issues).toEqual(['username missing', 'password missing']);
  });
});
