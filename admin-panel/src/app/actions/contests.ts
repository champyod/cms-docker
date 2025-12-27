'use server'

import { prisma } from '@/lib/prisma';
import { contests } from '@prisma/client';
import { revalidatePath } from 'next/cache';

const CONTESTS_PER_PAGE = 20;

export async function getContests({ page = 1, search = '' }: { page?: number; search?: string }) {
  const skip = (page - 1) * CONTESTS_PER_PAGE;
  
  const where = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { description: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {};

  const [contests, total] = await Promise.all([
    prisma.contests.findMany({
      where,
      skip,
      take: CONTESTS_PER_PAGE,
      orderBy: { id: 'desc' },
    }),
    prisma.contests.count({ where }),
  ]);

  return {
    contests,
    totalPages: Math.ceil(total / CONTESTS_PER_PAGE),
    total,
  };
}

export async function createContest(data: {
  name: string;
  description: string;
  start: string | Date; 
  stop: string | Date; 
  timezone: string;
}) {
  const { name, description, start, stop, timezone } = data;

  try {
    // Use raw SQL because Prisma marks interval fields as Unsupported
    // and cannot set them through the typed API
    const startDate = new Date(start);
    const stopDate = new Date(stop);

    await prisma.$executeRaw`
      INSERT INTO contests (
        name, description, 
        allowed_localizations, languages,
        submissions_download_allowed, allow_questions, allow_user_tests,
        allow_unofficial_submission_before_analysis_mode, block_hidden_participations,
        allow_password_authentication, allow_registration,
        ip_restriction, ip_autologin,
        token_mode, token_gen_initial, token_gen_number,
        token_min_interval, token_gen_interval,
        start, stop,
        analysis_enabled, analysis_start, analysis_stop,
        score_precision, timezone
      ) VALUES (
        ${name}, ${description},
        ARRAY[]::varchar[], ARRAY[]::varchar[],
        true, true, false,
        false, false,
        true, false,
        false, false,
        'disabled', 0, 0,
        '0 seconds'::interval, '30 minutes'::interval,
        ${startDate}, ${stopDate},
        false, ${stopDate}, ${stopDate},
        0, ${timezone}
      )
    `;

    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error & { code?: string };
    if (e.code === 'P2002' || e.message?.includes('unique constraint')) {
      return { success: false, error: 'Contest name already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateContest(id: number, data: Omit<Partial<contests>, 'start' | 'stop'> & { start?: string | Date; stop?: string | Date }) {
  const { name, description, start, stop } = data;
  
  const updateData: Partial<contests> = {};
  if (name) updateData.name = name;
  if (description) updateData.description = description;
  if (start) updateData.start = new Date(start);
  if (stop) updateData.stop = new Date(stop);

  try {
    const contest = await prisma.contests.update({
      where: { id },
      data: updateData,
    });
    revalidatePath('/[locale]/contests');
    return { success: true, contest };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function deleteContest(id: number) {
  try {
    await prisma.contests.delete({
      where: { id },
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
