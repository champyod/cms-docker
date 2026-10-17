'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { filterReadableFieldsWith, getFieldAccess } from '@/lib/field-permissions';
import { type ListSortInput } from '@/lib/list-sorting';
import { userSortOrderBy } from '@/lib/user-sorting';
import { buildUserSearchWhere, usersPageSelect, type UsersPageRow } from '@/lib/prisma-selects';
import * as peopleReadModels from '@/lib/people-read-models';
import { parseStoredPassword } from '@/lib/password-format';
import { recordAudit } from '@/lib/audit';

const USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;

// Why: on-demand record read — the User record header fetches its edit payload
// through this wrapper instead of widening the layout's summary read.
export async function getUserEditData(userId: number): Promise<Awaited<ReturnType<typeof peopleReadModels.getUserEditData>>> {
  return peopleReadModels.getUserEditData(userId);
}

interface UsersPageResult {
  users: UsersPageRow[];
  totalPages: number;
  currentPage: number;
  perPage: number;
  total: number;
  sort?: ListSortInput;
  effectivePermissions: ReadonlySet<string>;
}

/**
 * Every user id the current search matches, across pages.
 *
 * WHY a read of its own and not a page: the users list's header cell promises to select what the
 * search matches, and a page is only the slice the reader is looking at. The list asks for the full
 * id set when the operator selects all, so a select-all never silently covers fewer rows than the
 * filter does.
 */
export async function listUserIds(search = ''): Promise<number[]> {
  await ensurePermission('user:list');
  const rows = await prisma.users.findMany({
    where: buildUserSearchWhere(search),
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => row.id);
}

export async function getUsers({ page = 1, search = '', perPage = USERS_PER_PAGE, sort = null }: { page?: number; search?: string; perPage?: number; sort?: ListSortInput }): Promise<UsersPageResult> {
  await ensurePermission('user:list');

  const safePerPage = Math.min(Math.max(Number(perPage) || USERS_PER_PAGE, 1), MAX_USERS_PER_PAGE);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safePerPage;

  const where = buildUserSearchWhere(search);

  const [users, total] = await Promise.all([
    prisma.users.findMany({
      where,
      skip,
      take: safePerPage,
      orderBy: userSortOrderBy(sort),
      select: usersPageSelect,
    }),
    prisma.users.count({ where }),
  ]);

  // Why: strip fields the caller cannot read (e.g., PII for viewers without user:read)
  const perms = await getPermissions();
  // Why: one access table for the page, built before the map, not one table per user.
  const usersAccess = getFieldAccess('users', perms);
  const filtered = users.map((user) =>
    filterReadableFieldsWith(usersAccess, user as unknown as Record<string, unknown>) as unknown as UsersPageRow,
  );

  return {
    users: filtered,
    totalPages: Math.max(Math.ceil(total / safePerPage), 1),
    currentPage: safePage,
    perPage: safePerPage,
    total,
    sort,
    effectivePermissions: perms,
  };
}

export async function revealUserPassword(id: number): Promise<
  { success: true; kind: 'plaintext'; value: string } | { success: true; kind: 'bcrypt' } | { success: false; error: string }
> {
  await ensurePermission('password:reveal');
  try {
    const row = await prisma.users.findUnique({ where: { id }, select: { password: true } });
    if (!row) {
      await recordAudit({
        verb: 'password:reveal',
        entity: 'user',
        entityId: String(id),
        beforeValues: { userId: id },
        // A named reason, not a message: this path failed before any secret was read, and the
        // reason belongs in the log while whatever the driver said does not.
        afterValues: { error: 'NotFound' },
        result: 'failure',
      });
      return { success: false, error: 'User not found' };
    }
    const parsed = parseStoredPassword(row.password);
    await recordAudit({
      verb: 'password:reveal',
      entity: 'user',
      entityId: String(id),
      beforeValues: { userId: id },
      afterValues: { kind: parsed.kind },
      result: 'success',
    });
    if (parsed.kind === 'bcrypt') return { success: true, kind: 'bcrypt' };
    return { success: true, kind: 'plaintext', value: parsed.value };
  } catch (error) {
    // Why this row exists: a reveal that fails is the shape a break-in attempt takes, and
    // password:reveal is already a verb whose failure pages Discord. The error name is the whole
    // payload — a message here can carry the query that was refused.
    await recordAudit({
      verb: 'password:reveal',
      entity: 'user',
      entityId: String(id),
      beforeValues: { userId: id },
      afterValues: { error: error instanceof Error ? error.name : 'UnknownError' },
      result: 'failure',
    });
    return { success: false, error: 'Unable to load password' };
  }
}

