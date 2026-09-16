import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { safeUserSelect } from '@/lib/prisma-selects';
import { formatStoredPassword, isPasswordKind, DEFAULT_PASSWORD_KIND } from '@/lib/password-format';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { normalizeLanguageCode } from '@/lib/constants/languages';

interface UserUpdateData {
  first_name: string;
  last_name: string;
  email?: string | null;
  timezone?: string | null;
  password?: string;
  preferred_languages?: string[];
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('user:update');
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

    if (Array.isArray(data.preferred_languages)) {
      const seen = new Set<string>();
      const normalized: string[] = [];
      for (const raw of data.preferred_languages) {
        if (typeof raw !== 'string') continue;
        const code = normalizeLanguageCode(raw);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        normalized.push(code);
      }
      updateData.preferred_languages = normalized;
    }

    const beforeUser = await prisma.users.findUnique({ where: { id }, select: { first_name: true, last_name: true, username: true, email: true, timezone: true } });
    await prisma.users.update({
      where: { id },
      data: updateData,
    });

    const user = await prisma.users.findUnique({ where: { id }, select: safeUserSelect });

    await recordAudit({
      verb: 'user:update',
      entity: 'user',
      entityId: String(id),
      beforeValues: beforeUser ? { first_name: beforeUser.first_name, last_name: beforeUser.last_name, username: beforeUser.username } : undefined,
      afterValues: { changedKeys: Object.keys(updateData).filter((k) => k !== 'password') },
      result: 'success',
    });
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
  const { authorized, response } = await verifyApiPermission('user:delete');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const beforeDeleteUser = await prisma.users.findUnique({ where: { id }, select: { username: true, first_name: true, last_name: true } });
    await prisma.users.delete({ where: { id } });
    await recordAudit({
      verb: 'user:delete',
      entity: 'user',
      entityId: String(id),
      beforeValues: beforeDeleteUser ? { username: beforeDeleteUser.username, first_name: beforeDeleteUser.first_name, last_name: beforeDeleteUser.last_name } : undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/users', 'page');
    return apiSuccess({ message: 'User deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
