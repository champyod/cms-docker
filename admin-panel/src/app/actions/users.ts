'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { filterReadableFields } from '@/lib/field-permissions';
import { buildUserSearchWhere, usersPageSelect, type UsersPageRow } from '@/lib/prisma-selects';
import { parseStoredPassword } from '@/lib/password-format';
import { recordAudit } from '@/lib/audit';

const USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;

interface UsersPageResult {
  users: UsersPageRow[];
  totalPages: number;
  currentPage: number;
  perPage: number;
  total: number;
}

export async function getUsers({ page = 1, search = '', perPage = USERS_PER_PAGE }: { page?: number; search?: string; perPage?: number }): Promise<UsersPageResult> {
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
      orderBy: { id: 'asc' },
      select: usersPageSelect,
    }),
    prisma.users.count({ where }),
  ]);

  // Why: strip fields the caller cannot read (e.g., PII for viewers without user:read)
  const perms = await getPermissions();
  const filtered = users.map((user) =>
    filterReadableFields('users', user as unknown as Record<string, unknown>, perms) as unknown as UsersPageRow,
  );

  return {
    users: filtered,
    totalPages: Math.max(Math.ceil(total / safePerPage), 1),
    currentPage: safePage,
    perPage: safePerPage,
    total,
  };
}

export async function revealUserPassword(id: number): Promise<
  { success: true; kind: 'plaintext'; value: string } | { success: true; kind: 'bcrypt' } | { success: false; error: string }
> {
  await ensurePermission('password:reveal');
  try {
    const row = await prisma.users.findUnique({ where: { id }, select: { password: true } });
    if (!row) return { success: false, error: 'User not found' };
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
  } catch {
    return { success: false, error: 'Unable to load password' };
  }
}

