import { prisma } from '@/lib/prisma';
import { sanitize, verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

function nullablePositive(val: unknown): number | null {
  const sanitized = sanitize(val as string | number | null | undefined);
  if (sanitized === null || sanitized === 0 || sanitized === '0') return null;
  return sanitized as number;
}

function cleanArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((v) => v !== null && v !== '') as string[];
}

function buildIntervals(data: Record<string, unknown>): {
  tokenMin: string;
  tokenGen: string;
  minSub: string | null;
  minUser: string | null;
} {
  const tokenMin = sanitize(data.token_min_interval as never) !== null ? `${data.token_min_interval} seconds` : '0 seconds';
  const tokenGen = sanitize(data.token_gen_interval as never) !== null ? `${data.token_gen_interval} minutes` : '30 minutes';
  const minSub =
    sanitize(data.min_submission_interval as never) !== null && sanitize(data.min_submission_interval as never) !== 0
      ? `${data.min_submission_interval} seconds`
      : null;
  const minUser =
    sanitize(data.min_user_test_interval as never) !== null && sanitize(data.min_user_test_interval as never) !== 0
      ? `${data.min_user_test_interval} seconds`
      : null;
  return { tokenMin, tokenGen, minSub, minUser };
}

async function insertTask(data: Record<string, unknown>): Promise<void> {
  const { tokenMin, tokenGen, minSub, minUser } = buildIntervals(data);
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
      ${data.name as string}, ${data.title as string}, ${sanitize(data.contest_id as never)}, null,
      ${cleanArray(data.submission_format).map((fmt: string) => fmt.replace(/%s/g, data.name as string))}::varchar[], ${cleanArray(data.primary_statements)}::varchar[], ${cleanArray(data.allowed_languages)}::varchar[],
      ${(data.token_mode as string) ?? 'disabled'}::token_mode, ${nullablePositive(data.token_max_number)}, ${tokenMin}::interval,
      ${(data.token_gen_initial as number) ?? 0}, ${(data.token_gen_number as number) ?? 0}, ${tokenGen}::interval, ${nullablePositive(data.token_gen_max)},
      ${nullablePositive(data.max_submission_number)}, ${nullablePositive(data.max_user_test_number)},
      ${minSub}::interval, ${minUser}::interval,
      ${(data.feedback_level as string) ?? 'restricted'}::feedback_level, ${(data.score_precision as number) ?? 0}, ${(data.score_mode as string) ?? 'max'}::score_mode
    )
  `;
}

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;
  try {
    const data = (await req.json()) as Record<string, unknown>;
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!name) return apiError({ message: 'Task name is required', status: 400 });
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return apiError({ message: 'Task name must contain only letters, numbers, hyphens and underscores', status: 400 });
    if (!title) return apiError({ message: 'Task title is required', status: 400 });
    if (data.contest_id !== undefined && data.contest_id !== null && data.contest_id !== '') {
      const contestId = Number(data.contest_id);
      if (!Number.isInteger(contestId) || contestId <= 0) return apiError({ message: 'Contest identifier must be a positive integer', status: 400 });
    }
    await insertTask(data);
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task created successfully' });
  } catch (error) {
    const e = error as { message?: string };
    if (e.message?.includes('unique constraint')) return apiError({ message: 'Task name already exists', status: 400 });
    return apiError(error);
  }
}
