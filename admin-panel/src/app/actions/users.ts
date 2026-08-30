'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { buildUserSearchWhere, usersPageSelect, type UsersPageRow } from '@/lib/prisma-selects';
import { parseStoredPassword } from '@/lib/password-format';

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
  await ensurePermission('users');

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

  return {
    users,
    totalPages: Math.max(Math.ceil(total / safePerPage), 1),
    currentPage: safePage,
    perPage: safePerPage,
    total,
  };
}

export async function revealUserPassword(id: number): Promise<
  { success: true; kind: 'plaintext'; value: string } | { success: true; kind: 'bcrypt' } | { success: false; error: string }
> {
  await ensurePermission('users');
  try {
    const row = await prisma.users.findUnique({ where: { id }, select: { password: true } });
    if (!row) return { success: false, error: 'User not found' };
    const parsed = parseStoredPassword(row.password);
    if (parsed.kind === 'bcrypt') return { success: true, kind: 'bcrypt' };
    return { success: true, kind: 'plaintext', value: parsed.value };
  } catch {
    return { success: false, error: 'Unable to load password' };
  }
}

