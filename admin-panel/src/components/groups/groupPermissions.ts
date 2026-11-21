import {
  PERMISSION_REGISTRY,
  type PermissionDefinition,
} from '@/lib/permission-registry';

export function groupPermissionsByModule(): Map<
  string,
  PermissionDefinition[]
> {
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const def of PERMISSION_REGISTRY) {
    const list = grouped.get(def.module);
    if (list) {
      list.push(def);
    } else {
      grouped.set(def.module, [def]);
    }
  }
  return grouped;
}
