'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { recordAudit } from '@/lib/audit';

export async function getAnnouncements(contestId: number) {
  await ensurePermission('announcement:list');
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
  await ensurePermission('announcement:create');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('announcements', {
    subject: data.subject,
    text: data.text,
  }, permissions);
  if (allowed.subject === undefined || allowed.text === undefined) {
    return { success: false, error: 'Insufficient field permissions' };
  }
  try {
    const announcement = await prisma.announcements.create({
      data: {
        contest_id: contestId,
        admin_id: adminId,
        subject: allowed.subject,
        text: allowed.text,
        timestamp: new Date(),
      }
    });
    await recordAudit({
      verb: 'announcement:create',
      entity: 'announcement',
      entityId: String(announcement.id),
      afterValues: { contestId, subject: allowed.subject, text: allowed.text },
      result: 'success',
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
  await ensurePermission('announcement:update');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('announcements', {
    subject: data.subject,
    text: data.text,
  }, permissions);
  try {
    await prisma.announcements.update({
      where: { id: announcementId },
      data: {
        ...(allowed.subject !== undefined && { subject: allowed.subject }),
        ...(allowed.text !== undefined && { text: allowed.text }),
      }
    });
    await recordAudit({
      verb: 'announcement:update',
      entity: 'announcement',
      entityId: String(announcementId),
      afterValues: allowed,
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteAnnouncement(announcementId: number) {
  await ensurePermission('announcement:delete');
  let beforeValues: unknown = undefined;
  try {
    beforeValues = await prisma.announcements.findUnique({ where: { id: announcementId } });
  } catch {
    beforeValues = undefined;
  }
  try {
    await prisma.announcements.delete({
      where: { id: announcementId }
    });
    await recordAudit({
      verb: 'announcement:delete',
      entity: 'announcement',
      entityId: String(announcementId),
      beforeValues,
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
