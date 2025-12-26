'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

const USERS_PER_PAGE = 20;

export async function getUsers({ page = 1, search = '' }: { page?: number; search?: string }) {
  const skip = (page - 1) * USERS_PER_PAGE;
  
  const where = search ? {
    OR: [
      { first_name: { contains: search, mode: 'insensitive' as const } },
      { last_name: { contains: search, mode: 'insensitive' as const } },
      { username: { contains: search, mode: 'insensitive' as const } },
      { email: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {};

  const [users, total] = await Promise.all([
    prisma.users.findMany({
      where,
      skip,
      take: USERS_PER_PAGE,
      orderBy: { id: 'desc' },
    }),
    prisma.users.count({ where }),
  ]);

  return {
    users,
    totalPages: Math.ceil(total / USERS_PER_PAGE),
    total,
  };
}

import { users } from '@prisma/client';

// ...

export async function createUser(data: Omit<users, 'id' | 'password' | 'preferred_languages'> & { password?: string }) {
  const { first_name, last_name, username, email, password, timezone } = data;
  
  if (!password) {
      return { success: false, error: 'Password is required' };
  }
  
  // Hash password compatible with CMS (bcrypt:<hash>)
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
        preferred_languages: [], // Default empty
      },
    });
    revalidatePath('/[locale]/users');
    return { success: true, user };
  } catch (error) {
    const e = error as Error & { code?: string };
    if (e.code === 'P2002') {
      return { success: false, error: 'Username already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateUser(id: number, data: Partial<users> & { password?: string }) {
  const { first_name, last_name, email, password, timezone } = data;
  
  const updateData: Partial<users> = {
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
    revalidatePath('/[locale]/users');
    return { success: true, user };
  } catch (error) {
      const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteUser(id: number) {
  try {
    await prisma.users.delete({
      where: { id },
    });
    revalidatePath('/[locale]/users');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
