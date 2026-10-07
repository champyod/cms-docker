import { describe, expect, it } from 'vitest';

import {
  ADMIN_TABLE,
  GRANT_TABLES,
} from '@/lib/backup-table-catalog';
import {
  PRIVILEGE_DETAIL_LIMIT,
  accountConflictErrors,
  accountConflictsBetween,
  accountDeltas,
  grantsTravel,
  membershipDeltas,
  overrideDeltas,
  parseAccounts,
  parseMemberships,
  parseOverrides,
  privilegeDeltas,
  privilegeWarnings,
} from '@/lib/restore-apply';
import type {
  AccountRow,
  MembershipRow,
  OverrideRow,
  PrivilegeFacts,
} from '@/lib/restore-apply';
import { privilegeFacts } from './restore-apply-fixtures';

const ADA: AccountRow = { id: 1, username: 'ada', enabled: true };
const GRACE: AccountRow = { id: 2, username: 'grace', enabled: false };
const ALAN: AccountRow = { id: 3, username: 'alan', enabled: true };

function accounts(...rows: AccountRow[]): readonly AccountRow[] {
  return rows;
}

function membership(username: string, groupName: string): MembershipRow {
  return { username, groupName };
}

function override(username: string, permissionKey: string, effect: string): OverrideRow {
  return { username, permissionKey, effect };
}

const ALL_GRANTS = mergeStrategies();

function mergeStrategies(overrides: Record<string, string> = {}): Record<string, string> {
  const strategies: Record<string, string> = { [ADMIN_TABLE]: 'merge' };
  for (const table of GRANT_TABLES) strategies[table] = 'merge';
  return { ...strategies, ...overrides };
}

describe('row parsing', () => {
  it('reads an account line back into its id, username and enabled flag', () => {
    expect(parseAccounts(['1|ada|t', '2|grace|f'])).toEqual([
      { id: 1, username: 'ada', enabled: true },
      { id: 2, username: 'grace', enabled: false },
    ]);
  });

  it('reads a membership line and an override line into their named fields', () => {
    expect(parseMemberships(['ada|Superadmin'])).toEqual([membership('ada', 'Superadmin')]);
    expect(parseOverrides(['ada|backup:restore|allow'])).toEqual([override('ada', 'backup:restore', 'allow')]);
  });

  it('refuses a line that carries no delimiter rather than reading empty fields', () => {
    expect(() => parseAccounts(['ada'])).toThrow(/delimited/);
    expect(() => parseMemberships(['ada'])).toThrow(/delimited/);
    expect(() => parseOverrides(['ada'])).toThrow(/delimited/);
  });
});

describe('accountConflictsBetween', () => {
  it('finds a username that exists on both sides under different ids', () => {
    const conflicts = accountConflictsBetween(accounts({ ...ADA, id: 7 }), accounts(ADA));
    expect(conflicts).toEqual([{ username: 'ada', stagedId: 7, liveId: 1 }]);
  });

  it('reports nothing for a username that matches on id, or exists on one side only', () => {
    expect(accountConflictsBetween(accounts(ADA), accounts(ADA))).toEqual([]);
    expect(accountConflictsBetween(accounts(ADA), accounts(ALAN))).toEqual([]);
    expect(accountConflictsBetween(accounts(), accounts(ADA))).toEqual([]);
  });

  it('names every conflicting username, sorted', () => {
    const conflicts = accountConflictsBetween(
      accounts({ ...ADA, id: 9 }, { ...GRACE, id: 8 }),
      accounts(ADA, GRACE),
    );
    expect(conflicts.map((conflict) => conflict.username)).toEqual(['ada', 'grace']);
  });
});

describe('accountConflictErrors', () => {
  const conflicting = privilegeFacts({
    archiveAccounts: accounts({ ...ADA, id: 7 }),
    liveAccounts: accounts(ADA),
    accountConflicts: accountConflictsBetween(accounts({ ...ADA, id: 7 }), accounts(ADA)),
  });

  it('refuses an admins merge that would violate the username unique index', () => {
    const errors = accountConflictErrors(conflicting, mergeStrategies());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"ada"');
    expect(errors[0]).toContain('archive id 7, live id 1');
    expect(errors[0]).toContain('unique');
    expect(errors[0]).toContain('roll the whole table back');
    expect(errors[0]).toContain('Rename or remove');
  });

  it('refuses the overwrite too, which deletes and reinserts the same rows', () => {
    expect(accountConflictErrors(conflicting, mergeStrategies({ [ADMIN_TABLE]: 'overwrite' }))).toHaveLength(1);
  });

  it('stays silent when admins is not part of the promote', () => {
    expect(accountConflictErrors(conflicting, mergeStrategies({ [ADMIN_TABLE]: 'skip' }))).toEqual([]);
    expect(accountConflictErrors(conflicting, {})).toEqual([]);
  });

  it('stays silent when every username matches on id', () => {
    const clean = privilegeFacts({
      archiveAccounts: accounts(ADA),
      liveAccounts: accounts(ADA),
      accountConflicts: [],
    });
    expect(accountConflictErrors(clean, mergeStrategies())).toEqual([]);
  });
});

describe('accountDeltas', () => {
  it('calls a username the archive adds new, and one only live has absent-live', () => {
    const deltas = accountDeltas(privilegeFacts({
      archiveAccounts: accounts(ADA, GRACE),
      liveAccounts: accounts(ADA, ALAN),
    }));
    expect(deltas).toEqual([
      { username: 'alan', kind: 'absent-live', stagedId: null, liveId: 3 },
      { username: 'grace', kind: 'new', stagedId: 2, liveId: null },
    ]);
  });

  it('calls a change to whether a matched login can be used an enabled flip', () => {
    const deltas = accountDeltas(privilegeFacts({
      archiveAccounts: accounts({ ...GRACE, enabled: true }),
      liveAccounts: accounts(GRACE),
    }));
    expect(deltas).toEqual([{ username: 'grace', kind: 'enabled-flip', stagedId: 2, liveId: 2 }]);
  });

  it('reports nothing when both sides match on every field', () => {
    expect(accountDeltas(privilegeFacts({ archiveAccounts: accounts(ADA), liveAccounts: accounts(ADA) }))).toEqual([]);
  });
});

describe('membership and override deltas', () => {
  it('splits a membership change into gains and losses per username', () => {
    const deltas = membershipDeltas(privilegeFacts({
      archiveMemberships: [membership('ada', 'Superadmin'), membership('ada', 'Viewer')],
      liveMemberships: [membership('ada', 'Viewer'), membership('ada', 'Messaging')],
    }));
    expect(deltas).toEqual([{ username: 'ada', gains: ['Superadmin'], losses: ['Messaging'] }]);
  });

  it('reports a username that gains membership where the archive had none', () => {
    const deltas = membershipDeltas(privilegeFacts({
      archiveMemberships: [membership('grace', 'Superadmin')],
      liveMemberships: [],
    }));
    expect(deltas).toEqual([{ username: 'grace', gains: ['Superadmin'], losses: [] }]);
  });

  it('keeps only the stored effect and key for an override change', () => {
    const deltas = overrideDeltas(privilegeFacts({
      archiveOverrides: [override('ada', 'backup:restore', 'allow')],
      liveOverrides: [override('ada', 'backup:restore', 'deny')],
    }));
    expect(deltas).toEqual([{ username: 'ada', gains: ['allow backup:restore'], losses: ['deny backup:restore'] }]);
  });

  it('reports nothing when a side holds no rows at all', () => {
    expect(membershipDeltas(privilegeFacts())).toEqual([]);
    expect(overrideDeltas(privilegeFacts())).toEqual([]);
  });
});

describe('privilegeDeltas', () => {
  const facts: PrivilegeFacts = privilegeFacts({
    archiveAccounts: accounts(ADA),
    liveAccounts: accounts(ADA),
    archiveMemberships: [membership('ada', 'Superadmin')],
    liveMemberships: [],
  });

  it('measures accounts even when no grant table is in the promote', () => {
    const deltas = privilegeDeltas(facts, mergeStrategies({ admin_groups: 'skip' }));
    expect(deltas.memberships).toEqual([]);
  });

  it('measures membership only while admin_groups is in the promote', () => {
    const deltas = privilegeDeltas(facts, mergeStrategies());
    expect(deltas.memberships).toEqual([{ username: 'ada', gains: ['Superadmin'], losses: [] }]);
  });

  it('measures nothing at all while admins itself is skipped', () => {
    expect(privilegeDeltas(facts, mergeStrategies({ [ADMIN_TABLE]: 'skip' }))).toEqual({ accounts: [], memberships: [], overrides: [] });
  });
});

describe('grantsTravel', () => {
  it('is true while any grant table is applied', () => {
    expect(grantsTravel(mergeStrategies())).toBe(true);
    expect(grantsTravel(mergeStrategies({ admin_groups: 'skip', admin_permission_overrides: 'skip' }))).toBe(true);
  });

  it('is false when no grant table is applied', () => {
    const noGrants = mergeStrategies();
    for (const table of GRANT_TABLES) noGrants[table] = 'skip';
    expect(grantsTravel(noGrants)).toBe(false);
    expect(grantsTravel({ [ADMIN_TABLE]: 'merge' })).toBe(false);
  });
});

describe('privilegeWarnings', () => {
  const EDSGER: AccountRow = { id: 4, username: 'edsger', enabled: true };

  const full = privilegeFacts({
    archiveAccounts: accounts(ADA, { ...GRACE, enabled: true }, EDSGER),
    liveAccounts: accounts(ADA, GRACE, ALAN),
    archiveMemberships: [membership('ada', 'Superadmin'), membership('ada', 'Viewer')],
    liveMemberships: [membership('ada', 'Viewer')],
    archiveOverrides: [override('grace', 'backup:restore', 'allow')],
    liveOverrides: [],
  });

  it('says which logins are added, which flip, and which live ones the archive lacks', () => {
    const warnings = privilegeWarnings(full, mergeStrategies()).join('\n');
    expect(warnings).toContain('adds 1 login(s) live does not have: edsger');
    expect(warnings).toContain('changes whether 1 existing login(s) can be used');
    expect(warnings).toContain('grace enabled');
    expect(warnings).toContain('does not carry 1 live login(s), which keep whatever they have: alan');
  });

  it('says who gains and loses which group', () => {
    const warnings = privilegeWarnings(full, mergeStrategies()).join('\n');
    expect(warnings).toContain('"admin_groups" changes group membership for 1 admin(s)');
    expect(warnings).toContain('ada gains Superadmin');
  });

  it('says who gains which override, and that only an allow grants', () => {
    const warnings = privilegeWarnings(full, mergeStrategies()).join('\n');
    expect(warnings).toContain('"admin_permission_overrides" changes explicit grants for 1 admin(s)');
    expect(warnings).toContain('grace gains allow backup:restore');
    expect(warnings).toContain('Only a stored "allow" grants');
  });

  it('says privileges travel only when a grant table is co-selected', () => {
    const noGrants = mergeStrategies();
    for (const table of GRANT_TABLES) noGrants[table] = 'skip';
    const warnings = privilegeWarnings(full, noGrants).join('\n');
    expect(warnings).toContain('no grant table is in this promote');
    expect(warnings).toContain('restored onto an empty database has none');
    expect(warnings).not.toContain('"admin_groups" changes group membership');
  });

  it('says nothing while admins itself is skipped', () => {
    expect(privilegeWarnings(full, mergeStrategies({ [ADMIN_TABLE]: 'skip' }))).toEqual([]);
  });

  it('bounds a long membership change and says how many were left out', () => {
    const many = Array.from({ length: PRIVILEGE_DETAIL_LIMIT + 3 }, (_, index) => membership(`admin${String(index).padStart(2, '0')}`, 'Superadmin'));
    const warnings = privilegeWarnings(privilegeFacts({ archiveMemberships: many }), mergeStrategies()).join('\n');
    expect(warnings).toContain('changes group membership for 23 admin(s)');
    expect(warnings).toContain('and 3 further username(s) with membership changes');
    expect(warnings).not.toContain(`admin${PRIVILEGE_DETAIL_LIMIT + 2} gains`);
  });

  it('reports nothing for a promote whose admins match live exactly', () => {
    const identical = privilegeFacts({
      archiveAccounts: accounts(ADA),
      liveAccounts: accounts(ADA),
      archiveMemberships: [membership('ada', 'Viewer')],
      liveMemberships: [membership('ada', 'Viewer')],
    });
    const warnings = privilegeWarnings(identical, mergeStrategies());
    expect(warnings).toEqual([]);
  });
});