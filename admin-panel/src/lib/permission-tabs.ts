import { hasEffectivePermission } from '@/lib/permission-engine';

/** The tabs of the merged permissions page, each paired with the list key that gates it. */
export const PERMISSION_TAB_LIST_KEY = {
  admins: 'admin:list',
  groups: 'group:list',
} as const;

export type PermissionTab = keyof typeof PERMISSION_TAB_LIST_KEY;

const TAB_ORDER: readonly PermissionTab[] = ['admins', 'groups'];

/** The tabs a caller holding `effective` may read, in presentation order. */
export function permittedTabs(effective: ReadonlySet<string>): PermissionTab[] {
  return TAB_ORDER.filter((tab) => hasEffectivePermission(effective, PERMISSION_TAB_LIST_KEY[tab]));
}

/**
 * Why fallback rather than denial: an unknown or unreadable `tab` resolves to the first permitted tab,
 * so the /admins and /groups redirects — and any stale bookmark — still land on a section the caller may
 * read, while a tab whose own key is missing is never rendered.
 */
export function resolvePermissionTab(
  requested: string | undefined,
  permitted: readonly PermissionTab[],
): PermissionTab | null {
  const requestedTab = permitted.find((tab) => tab === requested);
  if (requestedTab) return requestedTab;
  return permitted.length > 0 ? permitted[0] : null;
}
