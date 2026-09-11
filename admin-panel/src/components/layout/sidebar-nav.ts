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

import { hasEffectivePermission } from '@/lib/permission-engine';

export interface NavItemDef {
  label: string;
  icon: LucideIcon;
  buildHref: (locale: string) => string;
  isVisible: (effective: ReadonlySet<string>) => boolean;
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
  { label: 'Contests', icon: Trophy, buildHref: (locale) => `/${locale}/contests`, isVisible: (effective) => hasEffectivePermission(effective, 'contest:list') },
  { label: 'Tasks', icon: FileCode, buildHref: (locale) => `/${locale}/tasks`, isVisible: (effective) => hasEffectivePermission(effective, 'task:list') },
  { label: 'Submissions', icon: Activity, buildHref: (locale) => `/${locale}/submissions`, isVisible: (effective) => hasEffectivePermission(effective, 'submission:list') },
  { label: 'Users', icon: Users, buildHref: (locale) => `/${locale}/users`, isVisible: (effective) => hasEffectivePermission(effective, 'user:list') },
  { label: 'Teams', icon: Users, buildHref: (locale) => `/${locale}/teams`, isVisible: (effective) => hasEffectivePermission(effective, 'team:list') },
];

export const INFRASTRUCTURE_ITEMS: NavItemDef[] = [
  { label: 'Active Contest', icon: Rocket, buildHref: (locale) => `/${locale}/deployments`, isVisible: (effective) => hasEffectivePermission(effective, 'deployment:list') },
  { label: 'Admins', icon: Shield, buildHref: (locale) => `/${locale}/admins`, isVisible: (effective) => hasEffectivePermission(effective, 'admin:list') },
  { label: 'Resources', icon: Activity, buildHref: (locale) => `/${locale}/resources`, isVisible: (effective) => hasEffectivePermission(effective, 'resource:list') },
  { label: 'Containers', icon: Box, buildHref: (locale) => `/${locale}/containers`, isVisible: (effective) => hasEffectivePermission(effective, 'container:list') },
  { label: 'Ranking', icon: Globe, buildHref: (locale) => `/${locale}/ranking`, isVisible: (effective) => hasEffectivePermission(effective, 'ranking:list') },
  { label: 'Appearance', icon: Palette, buildHref: (locale) => `/${locale}/appearance`, isVisible: (effective) => hasEffectivePermission(effective, 'appearance:list') },
  { label: 'Maintenance', icon: Wrench, buildHref: (locale) => `/${locale}/maintenance`, isVisible: (effective) => hasEffectivePermission(effective, 'maintenance:list') },
  { label: 'Settings', icon: Settings, buildHref: (locale) => `/${locale}/settings`, isVisible: (effective) => hasEffectivePermission(effective, 'settings:list') },
];
