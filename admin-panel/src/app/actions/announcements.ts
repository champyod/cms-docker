'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';

export async function getAnnouncements(contestId: number) {
  await ensurePermission('messaging');
  return prisma.announcements.findMany({
    where: { contest_id: contestId },
    include: { admins: { select: { username: true } } },
    orderBy: { timestamp: 'desc' }
  });
}

export async function createAnnouncement(contestId: number, adminId: number, data: {
  subject: string;
  text: string;
}) {
  await ensurePermission('messaging');
  try {
    await prisma.announcements.create({
      data: {
        contest_id: contestId,
        admin_id: adminId,
        subject: data.subject,
        text: data.text,
        timestamp: new Date(),
      }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function updateAnnouncement(announcementId: number, data: {
  subject?: string;
  text?: string;
}) {
  await ensurePermission('messaging');
  try {
    await prisma.announcements.update({
      where: { id: announcementId },
      data: {
        ...(data.subject && { subject: data.subject }),
        ...(data.text && { text: data.text }),
      }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteAnnouncement(announcementId: number) {
  await ensurePermission('messaging');
  try {
    await prisma.announcements.delete({
      where: { id: announcementId }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
