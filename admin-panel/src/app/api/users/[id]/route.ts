import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { safeUserSelect } from '@/lib/prisma-selects';
import { formatStoredPassword, isPasswordKind, DEFAULT_PASSWORD_KIND } from '@/lib/password-format';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

interface UserUpdateData {
  first_name: string;
  last_name: string;
  email?: string | null;
  timezone?: string | null;
  password?: string;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const { first_name, last_name, email, password, timezone } = data;

    const updateData: UserUpdateData = {
      first_name,
      last_name,
    };

    if (email !== undefined) updateData.email = email || null;
    if (timezone !== undefined) updateData.timezone = timezone || null;

    if (password) {
      const passwordKind = isPasswordKind(data.passwordKind) ? data.passwordKind : DEFAULT_PASSWORD_KIND;
      updateData.password = await formatStoredPassword(passwordKind, password);
    }

    await prisma.users.update({
      where: { id },
      data: updateData,
    });

    const user = await prisma.users.findUnique({ where: { id }, select: safeUserSelect });

    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ user });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    await prisma.users.delete({ where: { id } });
    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ message: 'User deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
