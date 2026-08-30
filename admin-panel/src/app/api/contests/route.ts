import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { validateContestData, intervalToString, CONSTRAINT_TO_FIELD_MAP, getConstraintErrorMessage } from '@/lib/contest-validation';

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  try {
    const data = await req.json();

    // Validate contest name
    const nameRegex = /^[A-Za-z0-9_-]+$/;
    if (!data.name || !nameRegex.test(data.name)) {
      return apiError({
        message: 'Contest name must contain only letters, numbers, hyphens and underscores',
        errors: [{ field: 'name', message: 'Contest name must contain only letters, numbers, hyphens and underscores', code: 'invalid_name' }],
        status: 400
      });
    }

    // Call validation library
    const validation = validateContestData(data);
    if (!validation.valid) {
      return apiError({
        message: 'Validation failed',
        errors: validation.errors,
        status: 400
      });
    }

    const startDate = new Date(data.start);
    const stopDate = new Date(data.stop);
    const analysisStart = data.analysis_start ? new Date(data.analysis_start) : new Date(stopDate.getTime() + 1000);
    const analysisStop = data.analysis_stop ? new Date(data.analysis_stop) : new Date(stopDate.getTime() + 2000);

    const languages = data.languages || [];
    const allowed_localizations = data.allowed_localizations || [];
    const token_mode = data.token_mode || 'disabled';
    const token_min_interval = intervalToString(data.token_min_interval || 0, 'seconds');
    const token_gen_interval = intervalToString(data.token_gen_interval || 30, 'minutes');
    const min_submission_interval = intervalToString(data.min_submission_interval || 0, 'seconds');
    const min_user_test_interval = intervalToString(data.min_user_test_interval || 0, 'seconds');
    const per_user_time = data.per_user_time !== undefined && data.per_user_time !== null
      ? intervalToString(data.per_user_time, 'seconds')
      : null;
    const min_submission_interval_grace_period = data.min_submission_interval_grace_period !== undefined && data.min_submission_interval_grace_period !== null
      ? intervalToString(data.min_submission_interval_grace_period, 'seconds')
      : null;
    const queue_fairness_penalty_seconds = Math.max(0, Number(data.queue_fairness_penalty_seconds ?? 0) || 0);

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
        queue_fairness_penalty_seconds,
        start, stop,
        analysis_enabled, analysis_start, analysis_stop,
        score_precision, timezone,
        per_user_time, min_submission_interval_grace_period
      ) VALUES (
        ${data.name}, ${data.description},
        ${allowed_localizations}, ${languages},
        ${data.submissions_download_allowed ?? true}, ${data.allow_questions ?? true}, ${data.allow_user_tests ?? false},
        ${data.allow_unofficial_submission_before_analysis_mode ?? false}, ${data.block_hidden_participations ?? false},
        ${data.allow_password_authentication ?? true}, ${data.allow_registration ?? false},
        ${data.ip_restriction ?? false}, ${data.ip_autologin ?? false},
        ${token_mode}::token_mode, ${data.token_max_number ?? null}, ${token_min_interval}::interval,
        ${data.token_gen_initial ?? 0}, ${data.token_gen_number ?? 0}, ${token_gen_interval}::interval, ${data.token_gen_max ?? null},
        ${data.max_submission_number ?? null}, ${data.max_user_test_number ?? null},
        ${min_submission_interval}::interval, ${min_user_test_interval}::interval,
        ${queue_fairness_penalty_seconds},
        ${startDate}, ${stopDate},
        ${data.analysis_enabled ?? false}, ${analysisStart}, ${analysisStop},
        ${data.score_precision ?? 0}, ${data.timezone},
        ${per_user_time}::interval, ${min_submission_interval_grace_period}::interval
      )
    `;

    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ message: 'Contest created successfully' });
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    // Check for DB check constraints
    for (const [constraint, field] of Object.entries(CONSTRAINT_TO_FIELD_MAP)) {
      if (err.message?.includes(constraint)) {
        return apiError({
          message: getConstraintErrorMessage(constraint),
          errors: [{ field, message: getConstraintErrorMessage(constraint), code: constraint }],
          status: 400
        });
      }
    }

    if (err.message?.includes('unique constraint') || err.code === 'P2002') {
      return apiError({ message: 'Contest name already exists', status: 400 });
    }
    return apiError(error);
  }
}
