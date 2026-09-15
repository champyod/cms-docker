import {
  Activity,
  BookOpen,
  Box,
  FileCode,
  Globe,
  Home,
  Palette,
  Rocket,
  Settings,
  Shield,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface SidebarPermissions {
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

export interface NavItemDef {
  label: string;
  icon: LucideIcon;
  buildHref: (locale: string) => string;
  isVisible: (visibility: NavVisibility) => boolean;
}

export const DASHBOARD_ITEM: NavItemDef = {
  label: 'Dashboard',
  icon: Home,
  buildHref: (locale) => `/${locale}`,
  isVisible: () => true,
};

export const DOCUMENTATION_ITEM: NavItemDef = {
  label: 'Documentation',
  icon: BookOpen,
  buildHref: (locale) => `/${locale}/docs`,
  isVisible: () => true,
};

export const CONTEST_ITEMS: NavItemDef[] = [
  { label: 'Contests', icon: Trophy, buildHref: (locale) => `/${locale}/contests`, isVisible: (visibility) => visibility.contests },
  { label: 'Tasks', icon: FileCode, buildHref: (locale) => `/${locale}/tasks`, isVisible: (visibility) => visibility.tasks },
  { label: 'Submissions', icon: Activity, buildHref: (locale) => `/${locale}/submissions`, isVisible: (visibility) => visibility.contests },
  { label: 'Users', icon: Users, buildHref: (locale) => `/${locale}/users`, isVisible: (visibility) => visibility.users },
  { label: 'Teams', icon: Users, buildHref: (locale) => `/${locale}/teams`, isVisible: (visibility) => visibility.users },
];

export const INFRASTRUCTURE_ITEMS: NavItemDef[] = [
  { label: 'Active Contest', icon: Rocket, buildHref: (locale) => `/${locale}/deployments`, isVisible: () => true },
  { label: 'Admins', icon: Shield, buildHref: (locale) => `/${locale}/admins`, isVisible: () => true },
  { label: 'Resources', icon: Activity, buildHref: (locale) => `/${locale}/resources`, isVisible: () => true },
  { label: 'Containers', icon: Box, buildHref: (locale) => `/${locale}/containers`, isVisible: () => true },
  { label: 'Ranking', icon: Globe, buildHref: (locale) => `/${locale}/ranking`, isVisible: () => true },
  { label: 'Appearance', icon: Palette, buildHref: (locale) => `/${locale}/appearance`, isVisible: () => true },
  { label: 'Maintenance', icon: Wrench, buildHref: (locale) => `/${locale}/maintenance`, isVisible: () => true },
  { label: 'Settings', icon: Settings, buildHref: (locale) => `/${locale}/settings`, isVisible: () => true },
];

export function buildVisibility(permissions?: SidebarPermissions): NavVisibility {
  const superadmin = permissions?.permission_all ?? false;
  return {
    superadmin,
    contests: superadmin || (permissions?.permission_contests ?? false),
    tasks: superadmin || (permissions?.permission_tasks ?? false),
    users: superadmin || (permissions?.permission_users ?? false),
  };
}

export interface NavSection {
  label: string | null;
  items: NavItemDef[];
  superadminOnly?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  { label: null, items: [DASHBOARD_ITEM] },
  { label: 'Contest', items: CONTEST_ITEMS },
  { label: 'Infrastructure', items: INFRASTRUCTURE_ITEMS, superadminOnly: true },
];

export const MOBILE_PRIMARY_LABELS: readonly string[] = ['Dashboard', 'Contests', 'Tasks', 'Users', 'Submissions'];

export const MOBILE_PRIMARY_MAX = 5;

export function buildMobilePrimary(visibility: NavVisibility): NavItemDef[] {
  const ordered: NavItemDef[] = [
    DASHBOARD_ITEM,
    ...CONTEST_ITEMS.filter((item) => item.isVisible(visibility)),
    ...(visibility.superadmin ? INFRASTRUCTURE_ITEMS.filter((item) => item.isVisible(visibility)) : []),
    DOCUMENTATION_ITEM,
  ];
  const byLabel = new Map(ordered.map((item) => [item.label, item]));
  const primary: NavItemDef[] = [];
  for (const label of MOBILE_PRIMARY_LABELS) {
    const item = byLabel.get(label);
    if (item && !primary.includes(item)) primary.push(item);
  }
  for (const item of ordered) {
    if (primary.length >= MOBILE_PRIMARY_MAX) break;
    if (!primary.includes(item)) primary.push(item);
  }
  return primary.slice(0, MOBILE_PRIMARY_MAX);
}
