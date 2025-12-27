'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

// Get all admins
export async function getAdmins() {
  return prisma.admins.findMany({
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
}) {
  try {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    await prisma.admins.create({
      data: {
        name: data.name,
        username: data.username,
        authentication: `bcrypt:${hashedPassword}`,
        enabled: true,
        permission_all: data.permission_all ?? false,
        permission_messaging: data.permission_messaging ?? true,
      }
    });
    revalidatePath('/[locale]/admins');
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
  password?: string;
}) {
  try {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.permission_all !== undefined) updateData.permission_all = data.permission_all;
    if (data.permission_messaging !== undefined) updateData.permission_messaging = data.permission_messaging;
    if (data.password) {
      const hashedPassword = await bcrypt.hash(data.password, 10);
      updateData.authentication = `bcrypt:${hashedPassword}`;
    }
    
    await prisma.admins.update({
      where: { id: adminId },
      data: updateData
    });
    revalidatePath('/[locale]/admins');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete an admin
export async function deleteAdmin(adminId: number) {
  try {
    await prisma.admins.delete({ where: { id: adminId } });
    revalidatePath('/[locale]/admins');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
