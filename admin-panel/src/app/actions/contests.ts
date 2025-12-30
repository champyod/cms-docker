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

export interface ContestData {
  name: string;
  description: string;
  start: string | Date; 
  stop: string | Date; 
  timezone: string;
  languages?: string[];
  submissions_download_allowed?: boolean;
  allow_questions?: boolean;
  allow_user_tests?: boolean;
  allow_unofficial_submission_before_analysis_mode?: boolean;
  block_hidden_participations?: boolean;
  allow_password_authentication?: boolean;
  allow_registration?: boolean;
  ip_restriction?: boolean;
  ip_autologin?: boolean;
  token_mode?: string;
  token_max_number?: number;
  token_min_interval?: number;
  token_gen_initial?: number;
  token_gen_number?: number;
  token_gen_interval?: number;
  token_gen_max?: number;
  max_submission_number?: number;
  max_user_test_number?: number;
  min_submission_interval?: number;
  min_user_test_interval?: number;
  score_precision?: number;
  analysis_enabled?: boolean;
  analysis_start?: string | Date;
  analysis_stop?: string | Date;
}

export async function createContest(data: ContestData) {
  try {
    const startDate = new Date(data.start);
    const stopDate = new Date(data.stop);
    const analysisStart = data.analysis_start ? new Date(data.analysis_start) : new Date(stopDate.getTime() + 1000);
    const analysisStop = data.analysis_stop ? new Date(data.analysis_stop) : new Date(stopDate.getTime() + 2000);

    // Default values if not provided
    const languages = data.languages || [];
    const token_mode = data.token_mode || 'disabled';
    const token_min_interval = `${data.token_min_interval || 0} seconds`;
    const token_gen_interval = `${data.token_gen_interval || 30} minutes`;
    const min_submission_interval = `${data.min_submission_interval || 0} seconds`;
    const min_user_test_interval = `${data.min_user_test_interval || 0} seconds`;

    await prisma.$executeRaw`
      INSERT INTO contests (
        name, description, 
        allowed_localizations, languages,
        submissions_download_allowed, allow_questions, allow_user_tests,
        allow_unofficial_submission_before_analysis_mode, block_hidden_participations,
        allow_password_authentication, allow_registration,
        ip_restriction, ip_autologin,
        token_mode, token_max_number, token_min_interval, 
        token_gen_initial, token_gen_number, token_gen_interval, token_gen_max,
        max_submission_number, max_user_test_number,
        min_submission_interval, min_user_test_interval,
        start, stop,
        analysis_enabled, analysis_start, analysis_stop,
        score_precision, timezone
      ) VALUES (
        ${data.name}, ${data.description},
        ARRAY[]::varchar[], ${languages},
        ${data.submissions_download_allowed ?? true}, ${data.allow_questions ?? true}, ${data.allow_user_tests ?? false},
        ${data.allow_unofficial_submission_before_analysis_mode ?? false}, ${data.block_hidden_participations ?? false},
        ${data.allow_password_authentication ?? true}, ${data.allow_registration ?? false},
        ${data.ip_restriction ?? false}, ${data.ip_autologin ?? false},
        ${token_mode}::token_mode, ${data.token_max_number ?? 0}, ${token_min_interval}::interval,
        ${data.token_gen_initial ?? 0}, ${data.token_gen_number ?? 0}, ${token_gen_interval}::interval, ${data.token_gen_max ?? 0},
        ${data.max_submission_number ?? 0}, ${data.max_user_test_number ?? 0},
        ${min_submission_interval}::interval, ${min_user_test_interval}::interval,
        ${startDate}, ${stopDate},
        ${data.analysis_enabled ?? false}, ${analysisStart}, ${analysisStop},
        ${data.score_precision ?? 0}, ${data.timezone}
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

export async function updateContest(id: number, data: Partial<ContestData>) {
  try {
    // Generate SET clause dynamically for raw query because of interval support
    // This is complex, so we'll use a mix of prepared statements and logical building
    // Actually, for safety and simplicity with intervals, raw SQL update is best for full update.

    // However, since we have many optional fields, constructing the query is tricky.
    // A simpler approach for this specific app usage (modal sends all fields) is to update all provided fields.

    // Let's assume the modal sends a relatively full payload for the sections it manages.

    // Helper to format date
    const toDate = (d: string | Date | undefined) => d ? new Date(d) : undefined;

    const startDate = toDate(data.start);
    const stopDate = toDate(data.stop);
    const analysisStart = toDate(data.analysis_start);
    const analysisStop = toDate(data.analysis_stop);

    // We will use prisma.update for standard fields and raw for intervals if needed
    // But since we can't mix easily in one transaction without raw, let's use raw for everything if intervals are involved.
    // Or, we update standard fields via Prisma and intervals via raw.
    // Let's use raw for everything to be safe and consistent.

    const token_min_interval = data.token_min_interval !== undefined ? `${data.token_min_interval} seconds` : null;
    const token_gen_interval = data.token_gen_interval !== undefined ? `${data.token_gen_interval} minutes` : null;
    const min_submission_interval = data.min_submission_interval !== undefined ? `${data.min_submission_interval} seconds` : null;
    const min_user_test_interval = data.min_user_test_interval !== undefined ? `${data.min_user_test_interval} seconds` : null;

    // We build the SET clause parts
    // Note: Prisma raw does not support dynamic column names easily with template literals for safety.
    // But here we know the columns.

    // Simplification: The modal sends ALL current state. So we can just UPDATE everything.
    // If some are undefined, we skip them? No, the modal sends the full object from state.

    await prisma.$executeRaw`
      UPDATE contests SET
        name = COALESCE(${data.name}, name),
        description = COALESCE(${data.description}, description),
        languages = COALESCE(${data.languages}, languages),
        start = COALESCE(${startDate}, start),
        stop = COALESCE(${stopDate}, stop),
        timezone = COALESCE(${data.timezone}, timezone),
        submissions_download_allowed = COALESCE(${data.submissions_download_allowed}, submissions_download_allowed),
        allow_questions = COALESCE(${data.allow_questions}, allow_questions),
        allow_user_tests = COALESCE(${data.allow_user_tests}, allow_user_tests),
        allow_unofficial_submission_before_analysis_mode = COALESCE(${data.allow_unofficial_submission_before_analysis_mode}, allow_unofficial_submission_before_analysis_mode),
        block_hidden_participations = COALESCE(${data.block_hidden_participations}, block_hidden_participations),
        allow_password_authentication = COALESCE(${data.allow_password_authentication}, allow_password_authentication),
        allow_registration = COALESCE(${data.allow_registration}, allow_registration),
        ip_restriction = COALESCE(${data.ip_restriction}, ip_restriction),
        ip_autologin = COALESCE(${data.ip_autologin}, ip_autologin),
        token_mode = COALESCE(${data.token_mode}::token_mode, token_mode),
        token_max_number = COALESCE(${data.token_max_number}, token_max_number),
        token_gen_initial = COALESCE(${data.token_gen_initial}, token_gen_initial),
        token_gen_number = COALESCE(${data.token_gen_number}, token_gen_number),
        token_gen_max = COALESCE(${data.token_gen_max}, token_gen_max),
        max_submission_number = COALESCE(${data.max_submission_number}, max_submission_number),
        max_user_test_number = COALESCE(${data.max_user_test_number}, max_user_test_number),
        score_precision = COALESCE(${data.score_precision}, score_precision),
        analysis_enabled = COALESCE(${data.analysis_enabled}, analysis_enabled),
        analysis_start = COALESCE(${analysisStart}, analysis_start),
        analysis_stop = COALESCE(${analysisStop}, analysis_stop),
        -- Handle Intervals specially
        token_min_interval = CASE WHEN ${token_min_interval}::text IS NOT NULL THEN ${token_min_interval}::interval ELSE token_min_interval END,
        token_gen_interval = CASE WHEN ${token_gen_interval}::text IS NOT NULL THEN ${token_gen_interval}::interval ELSE token_gen_interval END,
        min_submission_interval = CASE WHEN ${min_submission_interval}::text IS NOT NULL THEN ${min_submission_interval}::interval ELSE min_submission_interval END,
        min_user_test_interval = CASE WHEN ${min_user_test_interval}::text IS NOT NULL THEN ${min_user_test_interval}::interval ELSE min_user_test_interval END
      WHERE id = ${id}
    `;

    revalidatePath('/[locale]/contests');
    return { success: true };
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

export async function addParticipant(contestId: number, userId: number) {
  try {
    // Use raw SQL for interval fields
    await prisma.$executeRaw`
      INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
    `;
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function removeParticipant(participationId: number) {
  try {
    await prisma.participations.delete({
      where: { id: participationId },
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function addTaskToContest(contestId: number, taskId: number) {
  try {
    await prisma.tasks.update({
      where: { id: taskId },
      data: { contest_id: contestId }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function removeTaskFromContest(taskId: number) {
  try {
    await prisma.tasks.update({
      where: { id: taskId },
      data: { contest_id: null }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateContestSettings(id: number, data: Partial<ContestData>) {
  return updateContest(id, data);
}
