import type { Dictionary } from '@/lib/dictionary';
import { permittedNavItems } from '@/lib/navigation/module-nav';
import type { NavigationGroupDescriptor, RouteTab } from '@/lib/navigation/types';

type ModuleGroupId = NavigationGroupDescriptor['id'];

export function buildModuleTabs(
  groupId: ModuleGroupId,
  locale: string,
  dict: Dictionary,
  effective: ReadonlySet<string>,
): readonly RouteTab[] {
  return permittedNavItems(groupId, locale, dict, effective).map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
  }));
}
