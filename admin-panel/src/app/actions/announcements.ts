'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Get announcements for a contest
export async function getAnnouncements(contestId: number) {
  return prisma.announcements.findMany({
    where: { contest_id: contestId },
    include: { admins: { select: { username: true } } },
    orderBy: { timestamp: 'desc' }
  });
}

// Create an announcement
export async function createAnnouncement(contestId: number, adminId: number, data: {
  subject: string;
  text: string;
}) {
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
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Update an announcement
export async function updateAnnouncement(announcementId: number, data: {
  subject?: string;
  text?: string;
}) {
  try {
    await prisma.announcements.update({
      where: { id: announcementId },
      data: {
        ...(data.subject && { subject: data.subject }),
        ...(data.text && { text: data.text }),
      }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete an announcement
export async function deleteAnnouncement(announcementId: number) {
  try {
    await prisma.announcements.delete({
      where: { id: announcementId }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
