import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  try {
    const data = await req.json();
    await prisma.teams.create({
      data: {
        code: data.code,
        name: data.name,
      }
    });
    revalidatePath('/[locale]/teams', 'page');
    return apiSuccess({ message: 'Team created successfully' });
  } catch (error: any) {
    if (error.message?.includes('unique constraint')) return apiError({ message: 'Team code already exists', status: 400 });
    return apiError(error);
  }
}
