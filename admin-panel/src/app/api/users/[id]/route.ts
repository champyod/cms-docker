import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const { first_name, last_name, email, password, timezone } = data;

    const updateData: any = {
      first_name,
      last_name,
      email: email || null,
      timezone: timezone || null,
    };

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      updateData.password = `bcrypt:${hash}`;
    }

    const user = await prisma.users.update({
      where: { id },
      data: updateData,
    });

    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ user });
  } catch (error: any) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    await prisma.users.delete({ where: { id } });
    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ message: 'User deleted successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}
