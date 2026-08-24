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

export interface PalettePermissions {
  permission_all: boolean;
  permission_tasks: boolean;
  permission_users: boolean;
  permission_contests: boolean;
  permission_messaging: boolean;
}

export interface NavVisibility {
  superadmin: boolean;
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
  isVisible(visibility: NavVisibility): boolean;
}

const alwaysVisible = (): boolean => true;

export const PALETTE_NAV_ITEMS: PaletteNavItem[] = [
  { label: 'Dashboard', icon: Home, path: '/', group: 'general', isVisible: alwaysVisible },
  { label: 'Documentation', icon: BookOpen, path: '/docs', group: 'general', isVisible: alwaysVisible },
  { label: 'Contests', icon: Trophy, path: '/contests', group: 'contest', isVisible: (v) => v.contests },
  { label: 'Tasks', icon: FileCode, path: '/tasks', group: 'contest', isVisible: (v) => v.tasks },
  { label: 'Submissions', icon: Activity, path: '/submissions', group: 'contest', isVisible: (v) => v.contests },
  { label: 'Users', icon: Users, path: '/users', group: 'contest', isVisible: (v) => v.users },
  { label: 'Teams', icon: Users, path: '/teams', group: 'contest', isVisible: (v) => v.users },
  { label: 'Active Contest', icon: Rocket, path: '/deployments', group: 'infrastructure', isVisible: (v) => v.superadmin },
  { label: 'Admins', icon: Shield, path: '/admins', group: 'infrastructure', isVisible: (v) => v.superadmin },
  { label: 'Resources', icon: Activity, path: '/resources', group: 'infrastructure', isVisible: (v) => v.superadmin },
  { label: 'Containers', icon: Box, path: '/containers', group: 'infrastructure', isVisible: (v) => v.superadmin },
  { label: 'Ranking', icon: Globe, path: '/ranking', group: 'infrastructure', isVisible: (v) => v.superadmin },
  { label: 'Maintenance', icon: Wrench, path: '/maintenance', group: 'infrastructure', isVisible: (v) => v.superadmin },
  { label: 'Settings', icon: Settings, path: '/settings', group: 'infrastructure', isVisible: (v) => v.superadmin },
];

export function buildNavVisibility(permissions: PalettePermissions | null): NavVisibility {
  const superadmin = permissions?.permission_all ?? false;
  return {
    superadmin,
    contests: superadmin || (permissions?.permission_contests ?? false),
    tasks: superadmin || (permissions?.permission_tasks ?? false),
    users: superadmin || (permissions?.permission_users ?? false),
  };
}

export function filterNavItems(visibility: NavVisibility): PaletteNavItem[] {
  return PALETTE_NAV_ITEMS.filter((item) => item.isVisible(visibility));
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
