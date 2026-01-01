import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiAuth();
  if (!authorized) return response;

  try {
    const data = await req.json();
    const startDate = new Date(data.start);
    const stopDate = new Date(data.stop);
    const analysisStart = data.analysis_start ? new Date(data.analysis_start) : new Date(stopDate.getTime() + 1000);
    const analysisStop = data.analysis_stop ? new Date(data.analysis_stop) : new Date(stopDate.getTime() + 2000);

    const languages = data.languages || [];
    const token_mode = data.token_mode || 'disabled';
    const token_min_interval = `${data.token_min_interval || 0} seconds`;
    const token_gen_interval = `${data.token_gen_interval || 30} minutes`;
    const min_submission_interval = `${data.min_submission_interval || 0} seconds`;
    const min_user_test_interval = `${data.min_user_test_interval || 0} seconds`;

    const nullablePositive = (val: any) => (val && val != '0' ? val : null);

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
        ${token_mode}::token_mode, ${nullablePositive(data.token_max_number)}, ${token_min_interval}::interval,
        ${data.token_gen_initial ?? 0}, ${data.token_gen_number ?? 0}, ${token_gen_interval}::interval, ${nullablePositive(data.token_gen_max)},
        ${nullablePositive(data.max_submission_number)}, ${nullablePositive(data.max_user_test_number)},
        ${min_submission_interval}::interval, ${min_user_test_interval}::interval,
        ${startDate}, ${stopDate},
        ${data.analysis_enabled ?? false}, ${analysisStart}, ${analysisStop},
        ${data.score_precision ?? 0}, ${data.timezone}
      )
    `;

    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ message: 'Contest created successfully' });
  } catch (error: any) {
    if (error.message?.includes('unique constraint')) {
      return apiError({ message: 'Contest name already exists', status: 400 });
    }
    return apiError(error);
  }
}
