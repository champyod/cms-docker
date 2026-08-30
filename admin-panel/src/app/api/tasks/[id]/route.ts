import { prisma } from '@/lib/prisma';
import { sanitize, verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { addIntervalClause } from '@/lib/task-intervals';

type SanitizedData = Record<string, unknown>;

function sanitizeTaskData(raw: Record<string, unknown>): SanitizedData {
  const sanitized: SanitizedData = {};
  for (const key in raw) sanitized[key] = sanitize(raw[key] as never);
  const maxFields = ['max_submission_number', 'max_user_test_number', 'token_max_number', 'token_gen_max'];
  for (const key of maxFields) if (sanitized[key] === 0 || sanitized[key] === '0') sanitized[key] = null;
  return sanitized;
}

async function normalizeSubmissionFormat(data: SanitizedData, taskId: number): Promise<void> {
  if (!Array.isArray(data.submission_format)) return;
  data.submission_format = (data.submission_format as unknown[]).filter((v) => v !== null);
  const hasPlaceholder = (data.submission_format as string[]).some((fmt) => fmt.includes('%s'));
  if (!hasPlaceholder) return;
  let taskName = data.name as string | undefined;
  if (!taskName) {
    const existing = await prisma.tasks.findUnique({ where: { id: taskId }, select: { name: true } });
    taskName = existing?.name ?? undefined;
  }
  if (taskName) data.submission_format = (data.submission_format as string[]).map((fmt) => fmt.replace(/%s/g, taskName as string));
}

function splitFields(sanitized: SanitizedData): { standardFields: Record<string, unknown>; intervalFields: Record<string, unknown> } {
  const requiredIntervals = ['token_min_interval', 'token_gen_interval'];
  const optionalIntervals = ['min_submission_interval', 'min_user_test_interval'];
  const arrayFields = ['submission_format', 'primary_statements', 'allowed_languages'];
  const nullableKeys = ['contest_id', 'token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', 'score_precision', ...optionalIntervals];
  const standardFields: Record<string, unknown> = {};
  const intervalFields: Record<string, unknown> = {};
  for (const key in sanitized) {
    if ([...requiredIntervals, ...optionalIntervals, ...arrayFields].includes(key)) {
      if (requiredIntervals.includes(key) && sanitized[key] === null) continue;
      intervalFields[key] = sanitized[key];
    } else if (sanitized[key] !== null || nullableKeys.includes(key)) {
      if (sanitized[key] === null && ['score_precision', 'token_gen_initial', 'token_gen_number'].includes(key)) standardFields[key] = 0;
      else standardFields[key] = sanitized[key];
    }
  }
  return { standardFields, intervalFields };
}

async function applyTaskUpdates(id: number, standardFields: Record<string, unknown>, intervalFields: Record<string, unknown>): Promise<void> {
  if (Object.keys(standardFields).length > 0) await prisma.tasks.update({ where: { id }, data: standardFields });
  if (Object.keys(intervalFields).length === 0) return;
  const setClauses: string[] = [];
  const qParams: unknown[] = [];
  addIntervalClause(setClauses, qParams, intervalFields, 'token_min_interval', 'seconds');
  addIntervalClause(setClauses, qParams, intervalFields, 'token_gen_interval', 'minutes');
  addIntervalClause(setClauses, qParams, intervalFields, 'min_submission_interval', 'seconds');
  addIntervalClause(setClauses, qParams, intervalFields, 'min_user_test_interval', 'seconds');
  if (intervalFields.submission_format !== undefined) {
    qParams.push(intervalFields.submission_format);
    setClauses.push(`submission_format = $${qParams.length}::varchar[]`);
  }
  if (intervalFields.primary_statements !== undefined) {
    qParams.push(intervalFields.primary_statements);
    setClauses.push(`primary_statements = $${qParams.length}::varchar[]`);
  }
  if (intervalFields.allowed_languages !== undefined) {
    if (intervalFields.allowed_languages === null) setClauses.push(`allowed_languages = NULL`);
    else {
      qParams.push(intervalFields.allowed_languages);
      setClauses.push(`allowed_languages = $${qParams.length}::varchar[]`);
    }
  }
  if (setClauses.length > 0) {
    qParams.push(id);
    await prisma.$executeRawUnsafe(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${qParams.length}`, ...qParams);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const sanitized = sanitizeTaskData(raw);
    await normalizeSubmissionFormat(sanitized, id);
    const { standardFields, intervalFields } = splitFields(sanitized);
    await applyTaskUpdates(id, standardFields, intervalFields);
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task updated successfully' });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'P2002') return apiError({ message: 'Task name already exists', status: 400 });
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });
  try {
    await prisma.tasks.delete({ where: { id } });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
