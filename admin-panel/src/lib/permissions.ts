import { prisma } from '@/lib/prisma';
import { getSession } from "@/lib/auth";
import { redirect } from "@/lib/redirect";
import {
  resolveEffectivePermissions,
  hasEffectivePermission,
  type PermissionOverride,
} from '@/lib/permission-engine';

// Why: registry keys are always `${module}:${verb}`; this template literal rejects the legacy
// coarse names (all/tasks/users/contests/messaging) at compile time so stale call sites surface.
export type PermissionKey = `${string}:${string}`;

// Why: cache fresh permissions for 60 seconds to avoid a database round trip on every render while still reflecting revocation quickly
const accessCache = new Map<string, { value: ReadonlySet<string>; expires: number }>();
const ACCESS_TTL_MS = 60_000;

/**
 * Resolves the effective permission keys for an admin from group membership plus per-admin
 * overrides, never from the legacy boolean columns. Returns null (fail closed) for an
 * unknown/disabled admin or any database error.
 */
export async function getFreshPermissions(userId: string): Promise<ReadonlySet<string> | null> {
  const hit = accessCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const adminId = Number.parseInt(userId, 10);
  // Why: a non-numeric id can never match an admin row — deny without issuing a query
  if (!Number.isInteger(adminId)) return null;

  try {
    const admin = await prisma.admins.findUnique({
      where: { id: adminId },
      select: {
        enabled: true,
        admin_groups: {
          select: {
            groups: {
              select: {
                group_permissions: { select: { permissions: { select: { key: true } } } },
              },
            },
          },
        },
        permission_overrides: {
          select: {
            effect: true,
            permissions: { select: { key: true } },
          },
        },
      },
    });
    if (!admin || !admin.enabled) return null;

    const groupPermissionKeys: string[] = [];
    for (const membership of admin.admin_groups) {
      for (const link of membership.groups.group_permissions) {
        groupPermissionKeys.push(link.permissions.key);
      }
    }

    const overrides: PermissionOverride[] = admin.permission_overrides.map((override) => ({
      permissionKey: override.permissions.key,
      // Why: only an explicit "allow" grants; any other stored value is treated as a deny so a corrupt row fails closed
      effect: override.effect === 'allow' ? 'allow' : 'deny',
    }));

    const value = resolveEffectivePermissions(groupPermissionKeys, overrides);
    accessCache.set(userId, { value, expires: Date.now() + ACCESS_TTL_MS });
    return value;
  } catch {
    // Why: a database failure must deny rather than allow — fail closed
    return null;
  }
}

export function invalidateAccessCache(userId?: string): void {
  if (userId) accessCache.delete(userId); else accessCache.clear();
}

// Why: use fresh database permissions not stale token so revocation takes effect without leaking existence via distinct denial page
export async function checkPermission(permission: PermissionKey, redirectToLogin: boolean = true): Promise<boolean> {
  const session = await getSession();

  if (!session) {
    if (redirectToLogin) await redirect("/auth/login");
    return false;
  }

  const effective = await getFreshPermissions(session.userId);
  if (!effective) {
    if (redirectToLogin) await redirect("/auth/login");
    return false;
  }

  return hasEffectivePermission(effective, permission);
}

export async function ensurePermission(permission: PermissionKey): Promise<void> {
  const granted = await checkPermission(permission);
  if (!granted) {
    throw new Error(`Unauthorized: Missing ${permission} permission`);
  }
}

const EMPTY_PERMISSIONS: ReadonlySet<string> = new Set<string>();

/** Returns the current admin's effective permission keys, or an empty set when unauthenticated. */
export async function getPermissions(): Promise<ReadonlySet<string>> {
  const session = await getSession();
  if (!session?.userId) return EMPTY_PERMISSIONS;

  const effective = await getFreshPermissions(session.userId);
  if (!effective) return EMPTY_PERMISSIONS;

  return effective;
}
