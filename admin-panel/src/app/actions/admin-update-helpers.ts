import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { invalidateAccessCache } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { buildAdminUpdateData, type UpdateAdminInput } from '@/lib/admin-helpers';

async function recordPasswordChangeAudit(adminId: number): Promise<void> {
  // Why: a credential change is its own privilege (admin:password:update), so it gets its own verb;
  // only the fact that the credential changed is recorded — never the value or its stored hash.
  await recordAudit({
    verb: 'admin:password:update',
    entity: 'admin',
    entityId: String(adminId),
    afterValues: { passwordChanged: true },
    result: 'success',
  });
}

export async function handleAdminUpdateWrite(
  adminId: number,
  allowed: Record<string, unknown>,
): Promise<void> {
  const beforeAdmin = await prisma.admins.findUnique({
    where: { id: adminId },
    select: { name: true, enabled: true, username: true },
  });
  const updateData = await buildAdminUpdateData(allowed as unknown as UpdateAdminInput);
  await prisma.admins.update({ where: { id: adminId }, data: updateData });
  await recordAudit({
    verb: 'admin:update',
    entity: 'admin',
    entityId: String(adminId),
    beforeValues: beforeAdmin
      ? { name: beforeAdmin.name, enabled: beforeAdmin.enabled, username: beforeAdmin.username }
      : undefined,
    afterValues: { changedKeys: Object.keys(allowed) },
    result: 'success',
  });
  if (updateData.authentication !== undefined) {
    await recordPasswordChangeAudit(adminId);
  }
  invalidateAccessCache(String(adminId));
  revalidatePath('/[locale]/administration/admins', 'page');
}
