import { prisma } from '@/lib/prisma';
import {
  resolveEffectivePermissions,
  type OverrideEffect,
} from '@/lib/permission-engine';

/**
 * The effective permission set of another admin, read from the database.
 *
 * WHY this is not in `permission-engine.ts`: that module is imported by client components (every
 * action button reads its permission key from it), and it documents that constraint in its own
 * header. Resolving another admin's grants needs Prisma — which, since the row-level-security
 * change, reaches `next/headers` through the actor resolver — so it cannot live in a module the
 * browser bundle includes. Keeping it here is what keeps `permission-engine.ts` pure.
 */

export type TargetEffectiveResult =
  | { status: 'resolved'; effective: ReadonlySet<string> }
  | { status: 'not_found' }
  | { status: 'error'; cause: unknown };

export async function getTargetEffectivePermissions(adminId: number): Promise<TargetEffectiveResult> {
  if (!Number.isInteger(adminId)) return { status: 'not_found' };
  try {
    const admin = await prisma.admins.findUnique({
      where: { id: adminId },
      select: {
        admin_groups: { select: { groups: { select: { group_permissions: { select: { permissions: { select: { key: true } } } } } } } },
        permission_overrides: { select: { effect: true, permissions: { select: { key: true } } } },
      },
    });
    if (!admin) return { status: 'not_found' };
    const keys: string[] = [];
    for (const m of admin.admin_groups) for (const l of m.groups.group_permissions) keys.push(l.permissions.key);
    const overrides: { permissionKey: string; effect: OverrideEffect }[] = admin.permission_overrides.map((o) => ({
      permissionKey: o.permissions.key, effect: o.effect === 'allow' ? 'allow' : 'deny',
    }));
    return { status: 'resolved', effective: resolveEffectivePermissions(keys, overrides) };
  } catch (cause: unknown) {
    return { status: 'error', cause };
  }
}
