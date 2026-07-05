'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { ensurePermission } from '@/lib/permissions';

const USERS_PER_PAGE = 20;
const MAX_USERS_PER_PAGE = 100;

export async function getUsers({ page = 1, search = '', perPage = USERS_PER_PAGE }: { page?: number; search?: string; perPage?: number }) {
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
      include: {
        participations: {
          select: {
            teams: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
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

export async function createUser(data: Omit<any, 'id' | 'password' | 'preferred_languages'> & { password?: string }) {
  await ensurePermission('users');

  const { first_name, last_name, username, email, password, timezone } = data;

  if (!password) {
    return { success: false, error: 'Password is required' };
  }

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  const storedPassword = `bcrypt:${hash}`;

  try {
    const user = await prisma.users.create({
      data: {
        first_name,
        last_name,
        username,
        email: email || null,
        password: storedPassword,
        timezone: timezone || null,
        preferred_languages: [],
      },
    });
    revalidatePath('/[locale]/users', 'page');
    return { success: true, user };
  } catch (error) {
    const e = error as Error & { code?: string };
    if (e.code === 'P2002') {
      return { success: false, error: 'Username already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateUser(id: number, data: Partial<any> & { password?: string }) {
  await ensurePermission('users');

  const { first_name, last_name, email, password, timezone } = data;

  const updateData: Partial<any> = {
    first_name,
    last_name,
    email: email || null,
    timezone: timezone || null,
  };

  if (password) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    updateData.password = `bcrypt:${hash}`;
  }

  try {
    const user = await prisma.users.update({
      where: { id },
      data: updateData,
    });
    revalidatePath('/[locale]/users', 'page');
    return { success: true, user };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteUser(id: number) {
  await ensurePermission('users');

  try {
    await prisma.users.delete({
      where: { id },
    });
    revalidatePath('/[locale]/users', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
