'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Get participation details
export async function getParticipation(participationId: number) {
  return prisma.participations.findUnique({
    where: { id: participationId },
    include: {
      users: true,
      contests: true,
      submissions: { orderBy: { timestamp: 'desc' }, take: 10 },
      messages: { orderBy: { timestamp: 'desc' } },
      questions: { orderBy: { question_timestamp: 'desc' } },
    }
  });
}

// Update participation settings (uses raw SQL for interval fields)
export async function updateParticipation(participationId: number, data: {
  hidden?: boolean;
  unrestricted?: boolean;
  password?: string | null;
  extra_time_seconds?: number;
  delay_time_seconds?: number;
}) {
  try {
    // For interval fields, we need raw SQL
    if (data.extra_time_seconds !== undefined || data.delay_time_seconds !== undefined) {
      const extraTime = data.extra_time_seconds !== undefined ? `'${data.extra_time_seconds} seconds'::interval` : 'extra_time';
      const delayTime = data.delay_time_seconds !== undefined ? `'${data.delay_time_seconds} seconds'::interval` : 'delay_time';
      
      await prisma.$executeRawUnsafe(`
        UPDATE participations 
        SET extra_time = ${extraTime}, delay_time = ${delayTime}
        WHERE id = ${participationId}
      `);
    }
    
    // Update non-interval fields with Prisma
    await prisma.participations.update({
      where: { id: participationId },
      data: {
        ...(data.hidden !== undefined && { hidden: data.hidden }),
        ...(data.unrestricted !== undefined && { unrestricted: data.unrestricted }),
        ...(data.password !== undefined && { password: data.password }),
      }
    });
    
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Send a message to a participant
export async function sendMessage(participationId: number, adminId: number, data: {
  subject: string;
  text: string;
}) {
  try {
    await prisma.messages.create({
      data: {
        participation_id: participationId,
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

// Get messages for a participation
export async function getMessages(participationId: number) {
  return prisma.messages.findMany({
    where: { participation_id: participationId },
    include: { admins: { select: { username: true } } },
    orderBy: { timestamp: 'desc' }
  });
}
