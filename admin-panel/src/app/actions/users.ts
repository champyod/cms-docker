'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { safeUserSelect } from '@/lib/prisma-selects';

const USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;

export async function getUsers({ page = 1, search = '', perPage = USERS_PER_PAGE }: { page?: number; search?: string; perPage?: number }) {
  await ensurePermission('users');

  const safePerPage = Math.min(Math.max(Number(perPage) || USERS_PER_PAGE, 1), MAX_USERS_PER_PAGE);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safePerPage;

  const where = search
    ? {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' as const } },
          { last_name: { contains: search, mode: 'insensitive' as const } },
          { username: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { participations: { some: { teams: { code: { contains: search, mode: 'insensitive' as const } } } } },
          { participations: { some: { teams: { name: { contains: search, mode: 'insensitive' as const } } } } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.users.findMany({
      where,
      skip,
      take: safePerPage,
      orderBy: { id: 'asc' },
      select: {
        ...safeUserSelect,
        participations: { select: { teams: { select: { code: true, name: true } } } },
      },
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

