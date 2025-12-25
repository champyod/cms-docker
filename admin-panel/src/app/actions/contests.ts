'use server'

import { prisma } from '../../lib/prisma';
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

export async function createContest(data: Omit<contests, 'id' | 'allowed_localizations' | 'languages' | 'submissions_download_allowed' | 'allow_questions' | 'allow_user_tests' | 'allow_unofficial_submission_before_analysis_mode' | 'block_hidden_participations' | 'allow_password_authentication' | 'allow_registration' | 'ip_restriction' | 'ip_autologin' | 'token_mode' | 'token_max_number' | 'token_min_interval' | 'token_gen_initial' | 'token_gen_number' | 'token_gen_interval' | 'token_gen_max' | 'analysis_enabled' | 'analysis_start' | 'analysis_stop' | 'timezone' | 'per_user_time' | 'max_submission_number' | 'max_user_test_number' | 'min_submission_interval' | 'min_submission_interval_grace_period' | 'min_user_test_interval' | 'score_precision' | 'start' | 'stop'> & { 
    start: string | Date; 
    stop: string | Date;
    description: string;
}) {
  const { name, description, start, stop } = data;

  try {
    const contest = await prisma.contests.create({
      data: {
        name,
        description,
        start: new Date(start),
        stop: new Date(stop),
        // Defaults for required fields (assuming minimal setup for now)
        allowed_localizations: [],
        languages: [],
        submissions_download_allowed: true,
        allow_questions: true,
        allow_user_tests: false,
        allow_unofficial_submission_before_analysis_mode: false,
        block_hidden_participations: false,
        allow_password_authentication: true,
        allow_registration: false,
        ip_restriction: false,
        ip_autologin: false,
        token_mode: 'disabled', 
        token_gen_initial: 0,
        token_gen_number: 0,
        analysis_enabled: false,
        analysis_start: new Date(stop), // Default to stop time
        analysis_stop: new Date(stop),  // Default to stop time
        score_precision: 0,
      },
    });
    revalidatePath('/[locale]/contests');
    return { success: true, contest };
  } catch (error) {
    const e = error as Error & { code?: string };
    if (e.code === 'P2002') {
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
