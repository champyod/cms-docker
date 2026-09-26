import { hasEffectivePermission } from '@/lib/permission-engine';

export interface NavVisibility {
  contests: boolean;
  tasks: boolean;
  users: boolean;
}

/**
 * Entity-search capability, not navigation.
 *
 * Why it stays separate from the route registry: a searcher answers "which
 * entities may this reader look up", which is a subset question the registry
 * never asked, so the palette derives its navigation destinations from
 * `visibleRoutes` and keeps only this lookup gate here.
 */
export function buildNavVisibility(permissionKeys: readonly string[]): NavVisibility {
  const effective: ReadonlySet<string> = new Set(permissionKeys);
  return {
    contests: hasEffectivePermission(effective, 'contest:list'),
    tasks: hasEffectivePermission(effective, 'task:list'),
    users: hasEffectivePermission(effective, 'user:list'),
  };
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
