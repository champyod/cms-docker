'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { ensurePermission } from '@/lib/permissions';
import { getSession } from '@/lib/auth';
import { safeAdminSelect } from '@/lib/prisma-selects';

// Get all admins
export async function getAdmins() {
  await ensurePermission('all');
  return prisma.admins.findMany({
    select: safeAdminSelect,
    orderBy: { username: 'asc' }
  });
}

// Create an admin
export async function createAdmin(data: {
  name: string;
  username: string;
  password: string;
  permission_all?: boolean;
  permission_messaging?: boolean;
  permission_tasks?: boolean;
  permission_users?: boolean;
  permission_contests?: boolean;
}) {
  await ensurePermission('all');
  try {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    await prisma.admins.create({
      data: {
        name: data.name,
        username: data.username,
        authentication: `bcrypt:${hashedPassword}`,
        enabled: true,
        permission_all: data.permission_all ?? false,
        permission_messaging: data.permission_messaging ?? false,
        permission_tasks: data.permission_tasks ?? false,
        permission_users: data.permission_users ?? false,
        permission_contests: data.permission_contests ?? false,
      }
    });
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Admin username already exists' };
    }
    return { success: false, error: e.message };
  }
}

// Update an admin
export async function updateAdmin(adminId: number, data: {
  name?: string;
  enabled?: boolean;
  permission_all?: boolean;
  permission_messaging?: boolean;
  permission_tasks?: boolean;
  permission_users?: boolean;
  permission_contests?: boolean;
  password?: string;
}) {
  await ensurePermission('all');

  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  const target = await prisma.admins.findUnique({
    where: { id: adminId },
    select: { permission_all: true, enabled: true },
  });

  if (session.userId === String(adminId)
    && target?.permission_all === true
    && data.permission_all === false) {
    return { success: false, error: 'Cannot demote your own superadmin account' };
  }

  if (target?.permission_all === true
    && ((data.permission_all !== undefined && !data.permission_all) || data.enabled === false)) {
    const otherSupers = await prisma.admins.count({
      where: { permission_all: true, enabled: true, NOT: { id: adminId } },
    });
    if (otherSupers === 0) {
      return { success: false, error: 'Cannot remove the last superadmin' };
    }
  }

  try {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.permission_all !== undefined) updateData.permission_all = data.permission_all;
    if (data.permission_messaging !== undefined) updateData.permission_messaging = data.permission_messaging;
    if (data.permission_tasks !== undefined) updateData.permission_tasks = data.permission_tasks;
    if (data.permission_users !== undefined) updateData.permission_users = data.permission_users;
    if (data.permission_contests !== undefined) updateData.permission_contests = data.permission_contests;
    if (data.password) {
      const hashedPassword = await bcrypt.hash(data.password, 10);
      updateData.authentication = `bcrypt:${hashedPassword}`;
    }
    
    await prisma.admins.update({
      where: { id: adminId },
      data: updateData
    });
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete an admin
export async function deleteAdmin(adminId: number) {
  await ensurePermission('all');

  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  if (session.userId === String(adminId)) {
    return { success: false, error: 'Cannot delete your own account' };
  }

  const target = await prisma.admins.findUnique({
    where: { id: adminId },
    select: { permission_all: true },
  });

  if (target?.permission_all) {
    const otherSupers = await prisma.admins.count({
      where: { permission_all: true, enabled: true, NOT: { id: adminId } },
    });
    if (otherSupers === 0) {
      return { success: false, error: 'Cannot remove the last superadmin' };
    }
  }

  try {
    await prisma.admins.delete({ where: { id: adminId } });
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
