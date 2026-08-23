'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { ensurePermission, invalidateAccessCache } from '@/lib/permissions';
import { getSession, type AdminPermissions } from '@/lib/auth';
import { safeAdminSelect, type AdminWithLogin } from '@/lib/prisma-selects';

const BCRYPT_PREFIX = 'bcrypt:';
const BCRYPT_SALT_ROUNDS = 10;

interface ActionResult {
  success: boolean;
  error?: string;
}

interface CreateAdminInput extends Partial<AdminPermissions> {
  name: string;
  username: string;
  password: string;
}

interface UpdateAdminInput extends Partial<AdminPermissions> {
  name?: string;
  enabled?: boolean;
  password?: string;
}

type AdminUpdateData = {
  name?: string;
  enabled?: boolean;
  authentication?: string;
} & Partial<AdminPermissions>;

export async function getAdmins(): Promise<AdminWithLogin[]> {
  await ensurePermission('all');
  return prisma.admins.findMany({
    select: { ...safeAdminSelect, last_login_at: true },
    orderBy: { username: 'asc' }
  });
}

async function hashPassword(password: string): Promise<string> {
  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  return `${BCRYPT_PREFIX}${hashedPassword}`;
}

export async function createAdmin(data: CreateAdminInput): Promise<ActionResult> {
  await ensurePermission('all');
  try {
    await prisma.admins.create({
      data: {
        name: data.name,
        username: data.username,
        authentication: await hashPassword(data.password),
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

function findAdminTarget(adminId: number) {
  return prisma.admins.findUnique({
    where: { id: adminId },
    select: { permission_all: true, enabled: true },
  });
}

function isSelfDemotion(
  sessionUserId: string,
  adminId: number,
  target: { permission_all: boolean } | null,
  data: UpdateAdminInput
): boolean {
  return sessionUserId === String(adminId)
    && target?.permission_all === true
    && data.permission_all === false;
}

function removesSuperadminStatus(data: UpdateAdminInput): boolean {
  return (data.permission_all !== undefined && !data.permission_all) || data.enabled === false;
}

async function wouldRemoveLastSuperadmin(adminId: number): Promise<boolean> {
  const otherSupers = await prisma.admins.count({
    where: { permission_all: true, enabled: true, NOT: { id: adminId } },
  });
  return otherSupers === 0;
}

async function buildAdminUpdateData(data: UpdateAdminInput): Promise<AdminUpdateData> {
  const updateData: AdminUpdateData = {};
  if (data.name) updateData.name = data.name;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.permission_all !== undefined) updateData.permission_all = data.permission_all;
  if (data.permission_messaging !== undefined) updateData.permission_messaging = data.permission_messaging;
  if (data.permission_tasks !== undefined) updateData.permission_tasks = data.permission_tasks;
  if (data.permission_users !== undefined) updateData.permission_users = data.permission_users;
  if (data.permission_contests !== undefined) updateData.permission_contests = data.permission_contests;
  if (data.password) updateData.authentication = await hashPassword(data.password);
  return updateData;
}

export async function updateAdmin(adminId: number, data: UpdateAdminInput): Promise<ActionResult> {
  await ensurePermission('all');

  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  const target = await findAdminTarget(adminId);
  if (isSelfDemotion(session.userId, adminId, target, data)) {
    return { success: false, error: 'Cannot demote your own superadmin account' };
  }

  if (target?.permission_all === true && removesSuperadminStatus(data)) {
    if (await wouldRemoveLastSuperadmin(adminId)) {
      return { success: false, error: 'Cannot remove the last superadmin' };
    }
  }

  try {
    await prisma.admins.update({
      where: { id: adminId },
      data: await buildAdminUpdateData(data)
    });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteAdmin(adminId: number): Promise<ActionResult> {
  await ensurePermission('all');

  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  if (session.userId === String(adminId)) {
    return { success: false, error: 'Cannot delete your own account' };
  }

  const target = await findAdminTarget(adminId);
  if (target?.permission_all && await wouldRemoveLastSuperadmin(adminId)) {
    return { success: false, error: 'Cannot remove the last superadmin' };
  }

  try {
    await prisma.admins.delete({ where: { id: adminId } });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
