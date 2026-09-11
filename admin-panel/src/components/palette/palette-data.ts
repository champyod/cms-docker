import {
  Activity,
  BookOpen,
  Box,
  FileCode,
  Globe,
  Home,
  Rocket,
  Settings,
  Shield,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { hasEffectivePermission } from '@/lib/permission-engine';

export interface NavVisibility {
  contests: boolean;
  tasks: boolean;
  users: boolean;
}

export type NavGroup = 'general' | 'contest' | 'infrastructure';

export interface PaletteNavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  group: NavGroup;
  isVisible(effective: ReadonlySet<string>): boolean;
}

const alwaysVisible = (): boolean => true;

export const PALETTE_NAV_ITEMS: PaletteNavItem[] = [
  { label: 'Dashboard', icon: Home, path: '/', group: 'general', isVisible: alwaysVisible },
  { label: 'Documentation', icon: BookOpen, path: '/docs', group: 'general', isVisible: alwaysVisible },
  { label: 'Contests', icon: Trophy, path: '/contests', group: 'contest', isVisible: (effective) => hasEffectivePermission(effective, 'contest:list') },
  { label: 'Tasks', icon: FileCode, path: '/tasks', group: 'contest', isVisible: (effective) => hasEffectivePermission(effective, 'task:list') },
  { label: 'Submissions', icon: Activity, path: '/submissions', group: 'contest', isVisible: (effective) => hasEffectivePermission(effective, 'submission:list') },
  { label: 'Users', icon: Users, path: '/users', group: 'contest', isVisible: (effective) => hasEffectivePermission(effective, 'user:list') },
  { label: 'Teams', icon: Users, path: '/teams', group: 'contest', isVisible: (effective) => hasEffectivePermission(effective, 'team:list') },
  { label: 'Active Contest', icon: Rocket, path: '/deployments', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'deployment:list') },
  { label: 'Admins', icon: Shield, path: '/admins', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'admin:list') },
  { label: 'Resources', icon: Activity, path: '/resources', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'resource:list') },
  { label: 'Containers', icon: Box, path: '/containers', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'container:list') },
  { label: 'Ranking', icon: Globe, path: '/ranking', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'ranking:list') },
  { label: 'Maintenance', icon: Wrench, path: '/maintenance', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'maintenance:list') },
  { label: 'Settings', icon: Settings, path: '/settings', group: 'infrastructure', isVisible: (effective) => hasEffectivePermission(effective, 'settings:list') },
];

export function buildNavVisibility(permissionKeys: readonly string[]): NavVisibility {
  const effective = new Set(permissionKeys);
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
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return teams.filter(
    (team) => team.name.toLowerCase().includes(needle) || team.code.toLowerCase().includes(needle),
  );
}
