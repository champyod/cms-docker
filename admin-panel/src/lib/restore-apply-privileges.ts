/**
 * The privilege delta an admins restore carries, and the rules that refuse one.
 *
 * Privileges do not live on `admins`. An admin's authority is the group
 * membership in `admin_groups` plus the per-admin rows in
 * `admin_permission_overrides`, resolved through `groups`/`permissions`, so this
 * module compares all four on both sides of a promote and reports what a
 * co-selected restore would change.
 *
 * No docker, no Prisma, no filesystem: every rule here is decided from the row
 * sets the measurements collected, so the refusal and the report are testable
 * without a database. The statements those rows arrive through live in
 * `restore-apply-sql-queries.ts`; the decisions they feed in `restore-apply-plan.ts`.
 */

import { ADMIN_TABLE, GRANT_TABLES } from '@/lib/backup-table-catalog';
import { accountUsernameConflictId, accountUsernameConflictMessage } from '@/lib/restore-apply-conflicts';
import type { AccountUsernameConflict } from '@/lib/restore-apply-conflicts';

/** One account as both sides of a promote see it. */
export interface AccountRow {
  readonly id: number;
  readonly username: string;
  readonly enabled: boolean;
}

/** One membership edge, named by the text an operator recognizes rather than by id. */
export interface MembershipRow {
  readonly username: string;
  readonly groupName: string;
}

/** One per-admin override; `effect` is the stored value, which only `allow` grants. */
export interface OverrideRow {
  readonly username: string;
  readonly permissionKey: string;
  readonly effect: string;
}

/** An archive username that already exists live under a different id. */
export interface AccountConflict {
  readonly username: string;
  readonly stagedId: number;
  readonly liveId: number;
}

/** Everything the privilege rules are decided from. */
export interface PrivilegeFacts {
  readonly archiveAccounts: readonly AccountRow[];
  readonly liveAccounts: readonly AccountRow[];
  readonly archiveMemberships: readonly MembershipRow[];
  readonly liveMemberships: readonly MembershipRow[];
  readonly archiveOverrides: readonly OverrideRow[];
  readonly liveOverrides: readonly OverrideRow[];
  readonly accountConflicts: readonly AccountConflict[];
}

/** A username present on exactly one side, or enabled on one side only. */
export interface AccountDelta {
  readonly username: string;
  /** `new` and `absent-live` are the two account directions; `enabled-flip` is a change within a match. */
  readonly kind: 'new' | 'absent-live' | 'enabled-flip';
  readonly stagedId: number | null;
  readonly liveId: number | null;
}

/** What one username gains and loses, split by direction. */
export interface MembershipDelta {
  readonly username: string;
  readonly gains: readonly string[];
  readonly losses: readonly string[];
}

export interface OverrideDelta {
  readonly username: string;
  readonly gains: readonly string[];
  readonly losses: readonly string[];
}

export interface PrivilegeDeltas {
  readonly accounts: readonly AccountDelta[];
  readonly memberships: readonly MembershipDelta[];
  readonly overrides: readonly OverrideDelta[];
}

const EMPTY_DELTAS: PrivilegeDeltas = { accounts: [], memberships: [], overrides: [] };

// ---------------------------------------------------------------------------
// Reading the measured lines back into rows
// ---------------------------------------------------------------------------

/**
 * The delimiter the account, membership and override statements join their
 * fields with, mirrored from `FIELD_SEPARATOR` in `restore-apply-sql-queries.ts`
 * so both ends of every comparison split the same way. Neither half can contain
 * it: a username or group name is a codename drawn from a restricted charset and
 * a permission key never carries whitespace.
 */
const FIELD_SEPARATOR = '|';

function split(line: string): string[] {
  const parts = line.split(FIELD_SEPARATOR);
  if (parts.length < 2) throw new Error(`Expected a delimited privilege row, got: ${line}`);
  return parts;
}

export function parseAccounts(lines: readonly string[]): readonly AccountRow[] {
  return lines.map((line) => {
    const [id, username, enabled] = split(line);
    return { id: Number(id), username: username ?? '', enabled: enabled === 't' };
  });
}

export function parseMemberships(lines: readonly string[]): readonly MembershipRow[] {
  return lines.map((line) => {
    const [username, groupName] = split(line);
    return { username: username ?? '', groupName: groupName ?? '' };
  });
}

export function parseOverrides(lines: readonly string[]): readonly OverrideRow[] {
  return lines.map((line) => {
    const [username, permissionKey, effect] = split(line);
    return { username: username ?? '', permissionKey: permissionKey ?? '', effect: effect ?? '' };
  });
}

/** A membership or override applies only when its table is in this promote. */
function selectsGrant(strategy: string | undefined): boolean {
  return strategy !== undefined && strategy !== 'skip';
}

function indexBy<T, K extends string | number>(rows: readonly T[], key: (row: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (const row of rows) index.set(key(row), row);
  return index;
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const present = new Set(right);
  return [...new Set(left.filter((entry) => !present.has(entry)))].sort();
}

/** A membership or override change is one row's worth of text; the report names a bounded number of them. */
export const PRIVILEGE_DETAIL_LIMIT = 20;

function summarize(values: readonly string[]): string {
  const shown = values.slice(0, PRIVILEGE_DETAIL_LIMIT);
  const remainder = values.length - shown.length;
  return remainder > 0 ? `${shown.join(', ')} and ${remainder} more` : shown.join(', ');
}

function liveIdFor(accounts: ReadonlyMap<string, AccountRow>, username: string): number | null {
  return accounts.get(username)?.id ?? null;
}

export function accountDeltas(facts: PrivilegeFacts): readonly AccountDelta[] {
  const live = indexBy(facts.liveAccounts, (row) => row.username);
  const deltas: AccountDelta[] = [];
  for (const staged of facts.archiveAccounts) {
    const current = live.get(staged.username);
    if (current === undefined) {
      deltas.push({ username: staged.username, kind: 'new', stagedId: staged.id, liveId: null });
    } else if (current.enabled !== staged.enabled) {
      deltas.push({ username: staged.username, kind: 'enabled-flip', stagedId: staged.id, liveId: current.id });
    }
  }
  const stagedNames = new Set(facts.archiveAccounts.map((row) => row.username));
  for (const row of facts.liveAccounts) {
    if (!stagedNames.has(row.username)) {
      deltas.push({ username: row.username, kind: 'absent-live', stagedId: null, liveId: row.id });
    }
  }
  return deltas.sort((left, right) => left.username.localeCompare(right.username));
}

function pairDeltas<T extends { readonly username: string }>(
  archive: readonly T[],
  live: readonly T[],
  describe: (row: T) => string,
): readonly { username: string; gains: string[]; losses: string[] }[] {
  const stagedByUser = new Map<string, string[]>();
  const liveByUser = new Map<string, string[]>();
  for (const row of archive) stagedByUser.set(row.username, [...(stagedByUser.get(row.username) ?? []), describe(row)]);
  for (const row of live) liveByUser.set(row.username, [...(liveByUser.get(row.username) ?? []), describe(row)]);
  const deltas: { username: string; gains: string[]; losses: string[] }[] = [];
  for (const username of [...new Set([...stagedByUser.keys(), ...liveByUser.keys()])].sort()) {
    const gains = difference(stagedByUser.get(username) ?? [], liveByUser.get(username) ?? []);
    const losses = difference(liveByUser.get(username) ?? [], stagedByUser.get(username) ?? []);
    if (gains.length > 0 || losses.length > 0) deltas.push({ username, gains, losses });
  }
  return deltas;
}

export function membershipDeltas(facts: PrivilegeFacts): readonly MembershipDelta[] {
  return pairDeltas(facts.archiveMemberships, facts.liveMemberships, (row) => row.groupName);
}

export function overrideDeltas(facts: PrivilegeFacts): readonly OverrideDelta[] {
  return pairDeltas(facts.archiveOverrides, facts.liveOverrides, (row) => `${row.effect} ${row.permissionKey}`);
}

/**
 * The whole delta, or nothing. Every row set is only measured when its table is
 * in the promote, so a promote that touches `admins` alone reports accounts and
 * says privileges do not travel, rather than reporting a membership loss that
 * the merge will not make.
 */
export function privilegeDeltas(facts: PrivilegeFacts, strategies: Readonly<Record<string, string>>): PrivilegeDeltas {
  if (strategies[ADMIN_TABLE] === undefined || strategies[ADMIN_TABLE] === 'skip') return EMPTY_DELTAS;
  const memberships = selectsGrant(strategies['admin_groups']) ? membershipDeltas(facts) : [];
  const overrides = selectsGrant(strategies['admin_permission_overrides']) ? overrideDeltas(facts) : [];
  return { accounts: accountDeltas(facts), memberships, overrides };
}

/**
 * A username that exists on both sides under different ids.
 *
 * Compared from the two row sets rather than by one statement spanning both
 * databases, because the archive lives in the scratch container and the live rows
 * do not: no single query can see the pair. On a username shared by two different
 * ids the merge upserts on `id` alone, so it never conflicts on the primary key
 * and goes on to violate the unique index instead.
 */
export function accountConflictsBetween(
  archive: readonly AccountRow[],
  live: readonly AccountRow[],
): readonly AccountConflict[] {
  const liveIdsByName = new Map(live.map((row) => [row.username, row.id]));
  return archive
    .filter((row) => liveIdsByName.has(row.username) && liveIdsByName.get(row.username) !== row.id)
    .map((row) => ({ username: row.username, stagedId: row.id, liveId: liveIdsByName.get(row.username) ?? row.id }))
    .sort((left, right) => left.username.localeCompare(right.username));
}

/**
 * The index `admins.username` is unique by, in the name Prisma generates for it.
 *
 * Carried so the account conflict names the same index a generic unique check
 * would have named, which is what lets one prompt vocabulary cover both. The
 * generic check does not read this index, so the fact is reported once.
 */
export const ADMIN_USERNAME_INDEX = 'admins_username_key';

/**
 * Refuses a promote that would roll a table back on the `username` unique index,
 * as the structured conflicts the operator is prompted about.
 *
 * The merge upserts on `id` alone, so an archive username that already exists
 * live under a different id does not conflict on the primary key and proceeds to
 * violate `admins.username`'s unique index instead. Nothing partial is written:
 * the statement pair runs in one transaction, so the whole `admins` table is lost
 * to a conflict the operator could have been told about while reading the report.
 *
 * One username is one conflict, because a resolution rewrites one archive row:
 * folding them together would offer a single choice that had to mean something
 * different for each row it covered.
 */
export function accountConflictList(facts: PrivilegeFacts, strategies: Readonly<Record<string, string>>): readonly AccountUsernameConflict[] {
  if (strategies[ADMIN_TABLE] !== 'merge' && strategies[ADMIN_TABLE] !== 'overwrite') return [];
  return facts.accountConflicts.map((conflict) => ({
    id: accountUsernameConflictId(ADMIN_TABLE, conflict.stagedId),
    kind: 'account-username',
    table: ADMIN_TABLE,
    index: ADMIN_USERNAME_INDEX,
    columns: ['username'],
    pair: { username: conflict.username, stagedId: conflict.stagedId, liveId: conflict.liveId },
  }));
}

/** The refusal as text, kept as the shape the validate report's error list has always carried. */
export function accountConflictErrors(facts: PrivilegeFacts, strategies: Readonly<Record<string, string>>): readonly string[] {
  return accountConflictList(facts, strategies).map(accountUsernameConflictMessage);
}

function accountDeltaWarnings(facts: PrivilegeFacts, deltas: PrivilegeDeltas): readonly string[] {
  const byKind = (kind: AccountDelta['kind']): AccountDelta[] => deltas.accounts.filter((delta) => delta.kind === kind);
  const warnings: string[] = [];
  const added = byKind('new');
  if (added.length > 0) {
    warnings.push(`"${ADMIN_TABLE}" adds ${added.length} login(s) live does not have: ${summarize(added.map((delta) => delta.username))}.`);
  }
  const flipped = byKind('enabled-flip');
  if (flipped.length > 0) {
    const described = flipped.map((delta) => `${delta.username} ${archiveEnabled(facts, delta.username) ? 'enabled' : 'disabled'}`);
    warnings.push(`"${ADMIN_TABLE}" changes whether ${flipped.length} existing login(s) can be used after the restore: ${summarize(described)}.`);
  }
  const absent = byKind('absent-live');
  if (absent.length > 0) {
    warnings.push(`"${ADMIN_TABLE}" does not carry ${absent.length} live login(s), which keep whatever they have: ${summarize(absent.map((delta) => delta.username))}.`);
  }
  return warnings;
}

function archiveEnabled(facts: PrivilegeFacts, username: string): boolean {
  return facts.archiveAccounts.find((row) => row.username === username)?.enabled ?? false;
}

function membershipDeltaWarnings(deltas: readonly MembershipDelta[]): readonly string[] {
  if (deltas.length === 0) return [];
  const lines = deltas.slice(0, PRIVILEGE_DETAIL_LIMIT).map((delta) => {
    const parts: string[] = [];
    if (delta.gains.length > 0) parts.push(`gains ${summarize(delta.gains)}`);
    if (delta.losses.length > 0) parts.push(`loses ${summarize(delta.losses)}`);
    return `${delta.username} ${parts.join(' and ')}`;
  });
  const remainder = deltas.length - lines.length;
  const suffix = remainder > 0 ? `, and ${remainder} further username(s) with membership changes` : '';
  return [`"admin_groups" changes group membership for ${deltas.length} admin(s): ${lines.join('; ')}${suffix}.`];
}

function overrideDeltaWarnings(deltas: readonly OverrideDelta[]): readonly string[] {
  if (deltas.length === 0) return [];
  const lines = deltas.slice(0, PRIVILEGE_DETAIL_LIMIT).map((delta) => {
    const parts: string[] = [];
    if (delta.gains.length > 0) parts.push(`gains ${summarize(delta.gains)}`);
    if (delta.losses.length > 0) parts.push(`loses ${summarize(delta.losses)}`);
    return `${delta.username} ${parts.join(' and ')}`;
  });
  const remainder = deltas.length - lines.length;
  const suffix = remainder > 0 ? `, and ${remainder} further username(s) with override changes` : '';
  return [`"admin_permission_overrides" changes explicit grants for ${deltas.length} admin(s): ${lines.join('; ')}${suffix}. Only a stored "allow" grants; every other value denies.`];
}

/** Whether any grant table is in this promote, which is what makes privileges travel. */
export function grantsTravel(strategies: Readonly<Record<string, string>>): boolean {
  return GRANT_TABLES.some((table) => selectsGrant(strategies[table]));
}

/** The report the validate phase shows before the double-confirm is offered. */
export function privilegeWarnings(facts: PrivilegeFacts, strategies: Readonly<Record<string, string>>): readonly string[] {
  if (strategies[ADMIN_TABLE] === undefined || strategies[ADMIN_TABLE] === 'skip') return [];
  const deltas = privilegeDeltas(facts, strategies);
  const warnings = [...accountDeltaWarnings(facts, deltas)];
  if (!grantsTravel(strategies)) {
    warnings.push(
      `"${ADMIN_TABLE}" carries login hashes and account flags only: no grant table is in this promote, so no admin gains or loses a group or an override. A restored admin keeps the membership it already has live, and one restored onto an empty database has none.`,
    );
  }
  warnings.push(...membershipDeltaWarnings(deltas.memberships), ...overrideDeltaWarnings(deltas.overrides));
  return warnings;
}