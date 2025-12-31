import { prisma } from '@/lib/prisma';
import { sanitize, verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiAuth();
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const sanitizedData: any = {};
    for (const key in data) sanitizedData[key] = sanitize(data[key]);

    const standardFields: any = {};
    const intervalFields: any = {};
    const requiredIntervals = ['token_min_interval', 'token_gen_interval'];
    const optionalIntervals = ['min_submission_interval', 'min_user_test_interval'];
    const nullableKeys = ['contest_id', 'token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', ...optionalIntervals];

    for (const key in sanitizedData) {
      if ([...requiredIntervals, ...optionalIntervals].includes(key)) {
        if (requiredIntervals.includes(key) && sanitizedData[key] === null) continue;
        intervalFields[key] = sanitizedData[key];
      } else if (sanitizedData[key] !== null || nullableKeys.includes(key)) standardFields[key] = sanitizedData[key];
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
  const { authorized, response } = await verifyApiAuth();
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
