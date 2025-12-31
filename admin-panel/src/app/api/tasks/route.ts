import { prisma } from '@/lib/prisma';
import { sanitize, verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiAuth();
  if (!authorized) return response;

  try {
    const data = await req.json();
    
    const token_min_interval = sanitize(data.token_min_interval) !== null ? `${data.token_min_interval} seconds` : '0 seconds';
    const token_gen_interval = sanitize(data.token_gen_interval) !== null ? `${data.token_gen_interval} minutes` : '30 minutes';
    const min_submission_interval = sanitize(data.min_submission_interval) !== null ? `${data.min_submission_interval} seconds` : '0 seconds';
    const min_user_test_interval = sanitize(data.min_user_test_interval) !== null ? `${data.min_user_test_interval} seconds` : '0 seconds';

    await prisma.$executeRaw`
      INSERT INTO tasks (
        name, title, contest_id, num,
        submission_format, primary_statements, allowed_languages,
        token_mode, token_max_number, token_min_interval,
        token_gen_initial, token_gen_number, token_gen_interval, token_gen_max,
        max_submission_number, max_user_test_number,
        min_submission_interval, min_user_test_interval,
        feedback_level, score_precision, score_mode
      ) VALUES (
        ${data.name}, ${data.title}, ${sanitize(data.contest_id)}, null,
        ${data.submission_format || []}, ARRAY[]::varchar[], ${data.allowed_languages || []},
        ${data.token_mode || 'disabled'}::token_mode, ${sanitize(data.token_max_number)}, ${token_min_interval}::interval,
        ${data.token_gen_initial || 0}, ${data.token_gen_number || 0}, ${token_gen_interval}::interval, ${sanitize(data.token_gen_max)},
        ${sanitize(data.max_submission_number)}, ${sanitize(data.max_user_test_number)},
        ${min_submission_interval}::interval, ${min_user_test_interval}::interval,
        ${data.feedback_level || 'restricted'}::feedback_level, ${data.score_precision || 0}, ${data.score_mode || 'max'}::score_mode
      )
    `;
    
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task created successfully' });
  } catch (error: any) {
    if (error.message?.includes('unique constraint')) {
      return apiError({ message: 'Task name already exists', status: 400 });
    }
    return apiError(error);
  }
}
