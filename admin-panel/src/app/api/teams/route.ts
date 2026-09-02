import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!code) return apiError({ message: 'Team code is required', status: 400 });
    if (!/^[A-Za-z0-9_-]+$/.test(code)) return apiError({ message: 'Team code must contain only letters, numbers, hyphens and underscores', status: 400 });
    if (!name) return apiError({ message: 'Team name is required', status: 400 });
    if (name.length > 200) return apiError({ message: 'Team name must be at most 200 characters', status: 400 });
    await prisma.teams.create({
      data: {
        code,
        name,
      }
    });
    revalidatePath('/[locale]/teams', 'page');
    return apiSuccess({ message: 'Team created successfully' });
  } catch (error) {
    const e = error as { message?: string };
    if (e.message?.includes('unique constraint')) return apiError({ message: 'Team code already exists', status: 400 });
    return apiError(error);
  }
}
