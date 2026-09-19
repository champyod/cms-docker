import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import * as contestService from '@/lib/services/contests';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('contest:read');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const contest = await prisma.contests.findUnique({ where: { id } });
    if (!contest) return apiError({ message: 'Contest not found', status: 404 });
    return apiSuccess({ contest });
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const result = await contestService.updateContest(id, data);
    if (!result.success) {
      return apiError({ message: result.error ?? 'Validation failed', errors: result.errors, status: 400 });
    }
    revalidatePath('/[locale]/contests', 'page');
    revalidatePath(`/[locale]/contests/${id}`, 'page');
    return apiSuccess({ message: 'Contest updated successfully' });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err.status === 401 || err.status === 403) {
      return apiError({ message: err.message, status: err.status });
    }
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const result = await contestService.deleteContest(id);
    if (!result.success) {
      return apiError({ message: result.error ?? 'Delete failed', status: 400 });
    }
    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ message: 'Contest deleted successfully' });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err.status === 401 || err.status === 403) {
      return apiError({ message: err.message, status: err.status });
    }
    return apiError(error);
  }
}
