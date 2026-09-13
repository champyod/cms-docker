import type { OverrideEffect } from '@/lib/permission-engine';

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface AdminAccessGroup {
  id: number;
  name: string;
}

export interface AdminAccessOverride {
  permissionKey: string;
  effect: OverrideEffect;
  reason: string | null;
}

export interface AdminAccess {
  groups: AdminAccessGroup[];
  overrides: AdminAccessOverride[];
}

export interface GroupWithPermissions {
  id: number;
  name: string;
  description: string | null;
  is_seeded: boolean;
  permissionKeys: string[];
}

export interface AdminAccessSummary {
  adminId: number;
  groupNames: string[];
  overrideCount: number;
}

export function normaliseEffect(effect: string): OverrideEffect {
  // Why: a corrupt/legacy stored value must fail closed, so anything that is not an explicit "allow" is treated as a deny.
  return effect === 'allow' ? 'allow' : 'deny';
}
