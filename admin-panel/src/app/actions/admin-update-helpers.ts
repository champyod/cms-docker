import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { invalidateAccessCache } from '@/lib/permissions';
import { getAdminSecurityClient } from '@/lib/prisma';
import { buildAdminUpdateData, type UpdateAdminInput } from '@/lib/admin-helpers';

async function recordPasswordChangeAudit(adminId: number): Promise<void> {
  // Its own privilege and its own verb; only the fact of the change is recorded, never the value.
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
  const security = getAdminSecurityClient();
  const beforeAdmin = await security.admins.findUnique({
    where: { id: adminId },
    select: { name: true, enabled: true, username: true },
  });
  const updateData = await buildAdminUpdateData(allowed as unknown as UpdateAdminInput);
  // Explicit select: the role cannot read last_login_at, so a bare update's RETURNING would be refused.
  await security.admins.update({ where: { id: adminId }, data: updateData, select: { id: true } });
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
