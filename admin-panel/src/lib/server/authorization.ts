import { getSession } from '@/lib/auth';
import { getFreshPermissions, type PermissionKey } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';

// Why: services and routes need a thrown 401/403 contract that adapters can
// map to their transport (throw vs JSON) — a typed Error subclass carries the
// status and missing key without ad-hoc `{ status }` casts at each call site.
export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly permission?: PermissionKey;

  constructor(status: 401 | 403, permission?: PermissionKey) {
    super(
      status === 401
        ? 'Unauthorized'
        : `Unauthorized: Missing ${permission} permission`,
    );
    this.name = 'AuthorizationError';
    this.status = status;
    this.permission = permission;
  }
}

// Why: single choke point for server-side permission checks — 401 when no
// session, 403 when permissions fail closed or lack the key (all:all handled
// by the shared engine). Returning the effective set lets callers reuse it
// for field stripping without a second lookup.
export async function requirePermission(
  permission: PermissionKey,
): Promise<ReadonlySet<string>> {
  const session = await getSession();
  if (!session) throw new AuthorizationError(401);

  const effective = await getFreshPermissions(session.userId);
  if (!effective || !hasEffectivePermission(effective, permission)) {
    throw new AuthorizationError(403, permission);
  }
  return effective;
}
