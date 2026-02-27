import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const toDate = (d: any) => d ? new Date(d) : null;

    const startDate = toDate(data.start);
    const stopDate = toDate(data.stop);
    const analysisStart = toDate(data.analysis_start);
    const analysisStop = toDate(data.analysis_stop);

    const token_min_interval = data.token_min_interval !== undefined ? `${data.token_min_interval} seconds` : null;
    const token_gen_interval = data.token_gen_interval !== undefined ? `${data.token_gen_interval} minutes` : null;
    const min_submission_interval = data.min_submission_interval !== undefined ? `${data.min_submission_interval} seconds` : null;
    const min_user_test_interval = data.min_user_test_interval !== undefined ? `${data.min_user_test_interval} seconds` : null;

    await prisma.$executeRaw`
      UPDATE contests SET
        name = COALESCE(${data.name}, name),
        description = COALESCE(${data.description}, description),
        allowed_localizations = COALESCE(${data.allowed_localizations}, allowed_localizations),
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
        
        token_max_number = ${data.token_max_number},
        token_gen_max = ${data.token_gen_max},
        max_submission_number = ${data.max_submission_number},
        max_user_test_number = ${data.max_user_test_number},

        token_gen_initial = COALESCE(${data.token_gen_initial}, token_gen_initial),
        token_gen_number = COALESCE(${data.token_gen_number}, token_gen_number),
        score_precision = COALESCE(${data.score_precision}, score_precision),
        analysis_enabled = COALESCE(${data.analysis_enabled}, analysis_enabled),
        analysis_start = COALESCE(${analysisStart}, analysis_start),
        analysis_stop = COALESCE(${analysisStop}, analysis_stop),
        token_min_interval = CASE WHEN ${token_min_interval}::text IS NOT NULL THEN ${token_min_interval}::interval ELSE token_min_interval END,
        token_gen_interval = CASE WHEN ${token_gen_interval}::text IS NOT NULL THEN ${token_gen_interval}::interval ELSE token_gen_interval END,
        min_submission_interval = CASE WHEN ${min_submission_interval}::text IS NOT NULL THEN ${min_submission_interval}::interval ELSE min_submission_interval END,
        min_user_test_interval = CASE WHEN ${min_user_test_interval}::text IS NOT NULL THEN ${min_user_test_interval}::interval ELSE min_user_test_interval END
      WHERE id = ${id}
    `;

    revalidatePath('/[locale]/contests', 'page');
    revalidatePath(`/[locale]/contests/${id}`, 'page');
    return apiSuccess({ message: 'Contest updated successfully' });
  } catch (error: any) {
    if (error.code === 'P2002') return apiError({ message: 'Contest name already exists', status: 400 });
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('contests');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    await prisma.contests.delete({ where: { id } });
    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ message: 'Contest deleted successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}
