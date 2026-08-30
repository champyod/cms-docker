'use server';

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { safeUserSelect, safeAdminSelect } from '@/lib/prisma-selects';

export async function searchAll(query: string) {
  await ensurePermission('all');
  if (!query) return { users: [], tasks: [], contests: [], admins: [] };

  const [users, tasks, contests, admins] = await Promise.all([
    prisma.users.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { first_name: { contains: query, mode: 'insensitive' } },
          { last_name: { contains: query, mode: 'insensitive' } },
        ]
      },
      select: safeUserSelect,
      take: 10
    }),
    prisma.tasks.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { title: { contains: query, mode: 'insensitive' } },
        ]
      },
      take: 10
    }),
    prisma.contests.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ]
      },
      take: 10
    }),
    prisma.admins.findMany({
        where: {
             OR: [
                { username: { contains: query, mode: 'insensitive' } },
                 { name: { contains: query, mode: 'insensitive' } },
              ]
          },
          select: safeAdminSelect,
          take: 10
      })
  ]);

  return { users, tasks, contests, admins };
}
