import { prisma } from '@/lib/prisma';
import { sanitize, verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const sanitizedData: any = {};
    for (const key in data) sanitizedData[key] = sanitize(data[key]);

    // Handle "infinite" / "no limit" for max numbers where 0 implies infinite
    // Handle "infinite" / "no limit" for max numbers where 0 implies infinite
    const maxNumberFields = ['max_submission_number', 'max_user_test_number', 'token_max_number', 'token_gen_max'];
    for (const key of maxNumberFields) {
      if (sanitizedData[key] === 0 || sanitizedData[key] === '0') {
        sanitizedData[key] = null;
      }
    }

    // Clean array fields to remove nulls created by sanitize
    if (Array.isArray(sanitizedData.submission_format)) {
      sanitizedData.submission_format = sanitizedData.submission_format.filter((v: any) => v !== null);

      // Replace %s in submission_format with task name
      const hasPlaceholder = sanitizedData.submission_format.some((fmt: string) => fmt.includes('%s'));
      if (hasPlaceholder) {
        let taskName = sanitizedData.name;
        if (!taskName) {
           const existingTask = await prisma.tasks.findUnique({ where: { id }, select: { name: true } });
           taskName = existingTask?.name;
        }
        if (taskName) {
          sanitizedData.submission_format = sanitizedData.submission_format.map((fmt: string) => fmt.replace(/%s/g, taskName));
        }
      }
    }

    const standardFields: any = {};
    const intervalFields: any = {};
    const requiredIntervals = ['token_min_interval', 'token_gen_interval'];
    const optionalIntervals = ['min_submission_interval', 'min_user_test_interval'];
    const arrayFields = ['submission_format', 'primary_statements', 'allowed_languages'];
    const nullableKeys = ['contest_id', 'token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', 'score_precision', ...optionalIntervals];

    for (const key in sanitizedData) {
      if ([...requiredIntervals, ...optionalIntervals, ...arrayFields].includes(key)) {
        if (requiredIntervals.includes(key) && sanitizedData[key] === null) continue;
        intervalFields[key] = sanitizedData[key];
      } else if (sanitizedData[key] !== null || nullableKeys.includes(key)) {
        // Default NOT NULL numeric fields to 0 if they were cleared (null)
        if (sanitizedData[key] === null && ['score_precision', 'token_gen_initial', 'token_gen_number'].includes(key)) {
          standardFields[key] = 0;
        } else {
          standardFields[key] = sanitizedData[key];
        }
      }
    }

    if (Object.keys(standardFields).length > 0) {
      await prisma.tasks.update({ where: { id }, data: standardFields });
    }

    if (Object.keys(intervalFields).length > 0) {
      const setClauses: string[] = [], qParams: any[] = [];
      const addClause = (key: string, unit: string) => {
        if (intervalFields[key] !== undefined) {
          if (intervalFields[key] === null) setClauses.push(`${key} = NULL`);
          else {
            qParams.push(`${intervalFields[key]} ${unit}`);
            setClauses.push(`${key} = $${qParams.length}::interval`);
          }
        }
      };
      addClause('token_min_interval', 'seconds');
      addClause('token_gen_interval', 'minutes');
      addClause('min_submission_interval', 'seconds');
      addClause('min_user_test_interval', 'seconds');

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

    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task updated successfully' });
  } catch (error: any) {
    if (error.code === 'P2002') return apiError({ message: 'Task name already exists', status: 400 });
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    await prisma.tasks.delete({ where: { id } });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task deleted successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}
