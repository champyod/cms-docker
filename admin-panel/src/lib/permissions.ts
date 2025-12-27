import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export type Permission = 'all' | 'tasks' | 'users' | 'contests' | 'messaging';

export async function checkPermission(permission: Permission, redirectToLogin = true) {
  const session = await getSession();
  
  if (!session) {
    if (redirectToLogin) redirect("/auth/login");
    return false;
  }

  const { permissions } = session;
  if (!permissions) return false;

  // Superadmin has all permissions
  if (permissions.permission_all) return true;

  switch (permission) {
    case 'tasks':
      return permissions.permission_tasks;
    case 'users':
      return permissions.permission_users;
    case 'contests':
      return permissions.permission_contests;
    case 'messaging':
      return permissions.permission_messaging;
    case 'all':
      return false; // Only superadmin has 'all'
    default:
      return false;
  }
}

export async function ensurePermission(permission: Permission) {
  const hasPermission = await checkPermission(permission);
  if (!hasPermission) {
    throw new Error(`Unauthorized: Missing ${permission} permission`);
  }
}
