import { hasEffectivePermission } from '@/lib/permission-engine';
import type { PermissionKey } from '@/lib/permissions';

export type FieldAccess = { canRead: boolean; canUpdate: boolean };

export interface FieldPermissionDef {
  read: PermissionKey;
  update?: PermissionKey;
}

// Why: defines which permission keys gate read and update access for each field of each entity.
// Other entities (users, contests, …) adopt this same pattern by adding their own top-level entry.
export const FIELD_PERMISSION_MAP: Record<string, Record<string, FieldPermissionDef>> = {
  admins: {
    id: { read: 'admin:read' },
    name: { read: 'admin:read', update: 'admin:update' },
    username: { read: 'admin:read' },
    authentication: { read: 'password:reveal', update: 'admin:update' },
    password: { read: 'password:reveal', update: 'admin:update' },
    enabled: { read: 'admin:read', update: 'admin:update' },
    last_login_at: { read: 'audit:read' },
    admin_groups: { read: 'group:read', update: 'group:assign' },
    permission_overrides: { read: 'permission:read', update: 'override:set' },
  },
};

/** Returns per-field read/update booleans for the given entity, evaluated against effectivePermissions. */
export function getFieldAccess(
  entity: string,
  effectivePermissions: ReadonlySet<string>,
): Record<string, FieldAccess> {
  const map = FIELD_PERMISSION_MAP[entity];
  if (!map) return {};

  const result: Record<string, FieldAccess> = {};
  for (const field of Object.keys(map)) {
    const def = map[field];
    result[field] = {
      canRead: hasEffectivePermission(effectivePermissions, def.read),
      canUpdate: def.update ? hasEffectivePermission(effectivePermissions, def.update) : false,
    };
  }
  return result;
}

/** Returns only the keys of data that the caller has update permission for. */
export function stripDisallowedFields<T extends Record<string, unknown>>(
  entity: string,
  data: T,
  effectivePermissions: ReadonlySet<string>,
): Partial<T> {
  const map = FIELD_PERMISSION_MAP[entity];
  if (!map) return {};

  const access = getFieldAccess(entity, effectivePermissions);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (access[key]?.canUpdate) {
      result[key] = data[key];
    }
  }
  return result as Partial<T>;
}
