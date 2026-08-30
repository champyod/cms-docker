import { prisma } from '@/lib/prisma';
import { getSession } from "@/lib/auth";
import { redirect } from "@/lib/redirect";

export type Permission = 'all' | 'tasks' | 'users' | 'contests' | 'messaging';

export type FreshPermissions = { all: boolean; tasks: boolean; users: boolean; contests: boolean; messaging: boolean };

/** Superadmin (`all`) bypasses every check; the literal permission 'all' itself is never grantable below superadmin. */
export function hasPermission(fresh: FreshPermissions, permission: Permission): boolean {
  if (fresh.all) return true;
  switch (permission) {
    case 'tasks':
      return fresh.tasks;
    case 'users':
      return fresh.users;
    case 'contests':
      return fresh.contests;
    case 'messaging':
      return fresh.messaging;
    default:
      return false;
  }
}
const accessCache = new Map<string, { value: FreshPermissions; expires: number }>();
const ACCESS_TTL_MS = 60_000;

export async function getFreshPermissions(userId: string): Promise<FreshPermissions | null> {
  const hit = accessCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const admin = await prisma.admins.findUnique({
      where: { id: parseInt(userId) },
      select: { enabled: true, permission_all: true, permission_messaging: true, permission_tasks: true, permission_users: true, permission_contests: true },
    });
    if (!admin || !admin.enabled) return null;
    const value: FreshPermissions = { all: admin.permission_all, tasks: admin.permission_tasks, users: admin.permission_users, contests: admin.permission_contests, messaging: admin.permission_messaging };
    accessCache.set(userId, { value, expires: Date.now() + ACCESS_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

export function invalidateAccessCache(userId?: string): void {
  if (userId) accessCache.delete(userId); else accessCache.clear();
}

export async function checkPermission(permission: Permission, redirectToLogin = true) {
  const session = await getSession();
  
  if (!session) {
    if (redirectToLogin) await redirect("/auth/login");
    return false;
  }

  const fresh = await getFreshPermissions(session.userId);
  if (!fresh) {
    if (redirectToLogin) await redirect("/auth/login");
    return false;
  }

  return hasPermission(fresh, permission);
}

export async function ensurePermission(permission: Permission) {
  const hasPermission = await checkPermission(permission);
  if (!hasPermission) {
    throw new Error(`Unauthorized: Missing ${permission} permission`);
  }
}

export interface PermissionsSnapshot {
  permission_all: boolean;
  permission_tasks: boolean;
  permission_users: boolean;
  permission_contests: boolean;
  permission_messaging: boolean;
  all: boolean;
  tasks: boolean;
  users: boolean;
  contests: boolean;
  messaging: boolean;
}

const EMPTY_PERMISSIONS: PermissionsSnapshot = {
  permission_all: false,
  permission_tasks: false,
  permission_users: false,
  permission_contests: false,
  permission_messaging: false,
  all: false,
  tasks: false,
  users: false,
  contests: false,
  messaging: false,
};

function toSnapshot(fresh: FreshPermissions): PermissionsSnapshot {
  return {
    permission_all: fresh.all,
    permission_tasks: fresh.tasks,
    permission_users: fresh.users,
    permission_contests: fresh.contests,
    permission_messaging: fresh.messaging,
    all: fresh.all,
    tasks: fresh.tasks,
    users: fresh.users,
    contests: fresh.contests,
    messaging: fresh.messaging,
  };
}

export async function getPermissions(): Promise<PermissionsSnapshot> {
  const session = await getSession();
  if (!session?.userId) return EMPTY_PERMISSIONS;

  const fresh = await getFreshPermissions(session.userId);
  if (!fresh) return EMPTY_PERMISSIONS;

  return toSnapshot(fresh);
}
