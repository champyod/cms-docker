import { hasEffectivePermission } from '@/lib/permission-engine';
import { NAV_REGISTRY, type NavGroup as RegistryGroup } from '@/lib/nav-registry';

export interface NavVisibility {
  contests: boolean;
  tasks: boolean;
  users: boolean;
}

export type NavGroup = RegistryGroup;

export interface PaletteNavItem {
  label: string;
  icon: (typeof NAV_REGISTRY)[number]['icon'];
  path: string;
  group: NavGroup;
  isVisible(effective: ReadonlySet<string>): boolean;
}

// Why: palette navigation is a filtered view of the single registry so Groups/Audit/Appearance
// and /search cannot drift between surfaces.
export const PALETTE_NAV_ITEMS: PaletteNavItem[] = NAV_REGISTRY.filter((entry) =>
  entry.exposeIn.includes('palette'),
).map((entry) => ({
  label: entry.label,
  icon: entry.icon,
  path: entry.path,
  group: entry.group,
  isVisible: (effective: ReadonlySet<string>): boolean =>
    entry.permission === undefined || hasEffectivePermission(effective, entry.permission),
}));

export function buildNavVisibility(permissionKeys: readonly string[]): NavVisibility {
  const effective: ReadonlySet<string> = new Set(permissionKeys);
  return {
    contests: hasEffectivePermission(effective, 'contest:list'),
    tasks: hasEffectivePermission(effective, 'task:list'),
    users: hasEffectivePermission(effective, 'user:list'),
  };
}

export function filterNavItems(effective: ReadonlySet<string>): PaletteNavItem[] {
  return PALETTE_NAV_ITEMS.filter((item) => item.isVisible(effective));
}

export function isNumericQuery(query: string): boolean {
  return /^\d+$/.test(query.trim());
}

export interface TeamRow {
  id: number;
  code: string;
  name: string;
}

export function filterTeams(teams: TeamRow[], query: string): TeamRow[] {
  const needle: string = query.trim().toLowerCase();
  if (!needle) return [];
  return teams.filter(
    (team) => team.name.toLowerCase().includes(needle) || team.code.toLowerCase().includes(needle),
  );
}
