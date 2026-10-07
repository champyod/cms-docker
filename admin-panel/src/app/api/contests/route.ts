import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiError, apiSuccess } from '@/lib/api-utils';
import * as contestService from '@/lib/services/contests';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const data = await req.json();
    const result = await contestService.createContest(data);
    if (!result.success) {
      return apiError({
        message: result.error ?? 'Validation failed',
        errors: result.errors,
        status: 400,
      });
    }
    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ message: 'Contest created successfully' });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err.status === 401 || err.status === 403) {
      return apiError({ message: err.message, status: err.status });
    }
    return apiError(error);
  }
}
