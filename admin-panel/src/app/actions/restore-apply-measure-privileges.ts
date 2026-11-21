/**
 * Reading the privilege rows a promote compares: what the archive holds in the
 * scratch container, and what the live database holds now.
 *
 * Every statement here is read-only, and a table whose strategy is `skip` is not
 * read at all: a promote that does not touch `admin_groups` has no membership
 * delta to report, and measuring one would report a change the merge will not
 * make.
 *
 * Why every export carries `backup:restore` itself: this directory is scanned as
 * a set of entry points, so a helper the apply server actions compose is read as
 * one that can be called on its own. The callers gate the same key, so the
 * repeat check costs one cached session read and never widens or narrows what a
 * caller may already do.
 */

import { Prisma } from '@prisma/client';

import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { accountRowsSql, membershipRowsSql, overrideRowsSql } from '@/lib/restore-apply';
import { accountConflictsBetween, parseAccounts, parseMemberships, parseOverrides } from '@/lib/restore-apply';
import type { ApplyStrategies, PrivilegeFacts } from '@/lib/restore-apply';
import { scratchQuery } from './restore-preview-run';

/** One row set as the query returns it: one pipe-delimited line per row. */
type Lines = readonly string[];

const NO_LINES: Lines = [];

/** A live row set, read through Prisma so the applier needs no second connection. */
async function liveRows(sql: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`${Prisma.raw(sql)}`);
  return rows.map((row) => String(row.value));
}

/** The archive's half, read out of the scratch container holding the dump. */
async function archiveRows(container: string, sql: string): Promise<string[]> {
  const stdout = await scratchQuery(container, sql);
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

function applies(strategies: ApplyStrategies, table: string): boolean {
  return strategies[table] !== undefined && strategies[table] !== 'skip';
}

/**
 * The two sides of every comparison, each half read from where it actually
 * lives: the archive rows from the scratch container that holds the dump, the
 * live rows from the database the promote would write.
 *
 * The username conflict is not measured by a single statement spanning both
 * halves, because no statement can: the archive is in one container and the live
 * rows in another. Comparing the two row sets by username yields the same fact —
 * an archive username whose id is not the live id under that name — and does it
 * before anything is staged, so the conflict lands in the report the operator
 * confirms rather than in a rollback they watch happen.
 */
export async function measurePrivileges(container: string, strategies: ApplyStrategies): Promise<PrivilegeFacts> {
  await ensurePermission('backup:restore');
  const [archiveAccounts, liveAccounts, archiveMemberships, liveMemberships, archiveOverrides, liveOverrides] = await Promise.all([
    applies(strategies, 'admins') ? archiveRows(container, accountRowsSql()) : NO_LINES,
    applies(strategies, 'admins') ? liveRows(accountRowsSql()) : NO_LINES,
    applies(strategies, 'admin_groups') ? archiveRows(container, membershipRowsSql()) : NO_LINES,
    applies(strategies, 'admin_groups') ? liveRows(membershipRowsSql()) : NO_LINES,
    applies(strategies, 'admin_permission_overrides') ? archiveRows(container, overrideRowsSql()) : NO_LINES,
    applies(strategies, 'admin_permission_overrides') ? liveRows(overrideRowsSql()) : NO_LINES,
  ]);
  const staged = parseAccounts([...archiveAccounts]);
  const live = parseAccounts([...liveAccounts]);
  return {
    archiveAccounts: staged,
    liveAccounts: live,
    archiveMemberships: parseMemberships([...archiveMemberships]),
    liveMemberships: parseMemberships([...liveMemberships]),
    archiveOverrides: parseOverrides([...archiveOverrides]),
    liveOverrides: parseOverrides([...liveOverrides]),
    accountConflicts: accountConflictsBetween(staged, live),
  };
}