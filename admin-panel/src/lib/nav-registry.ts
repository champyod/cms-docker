import {
  Activity,
  BookOpen,
  Box,
  FileCode,
  Globe,
  Home,
  Palette,
  Rocket,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { hasEffectivePermission } from '@/lib/permission-engine';

/** Where a navigation entry is allowed to appear. */
export type NavSurface = 'sidebar' | 'palette' | 'chord' | 'mobile';

/** Sections are rendered in this order; a group absent from here is not rendered. */
export const NAV_GROUP_ORDER = ['general', 'contest', 'infrastructure'] as const;

export type NavGroup = (typeof NAV_GROUP_ORDER)[number];

export interface NavEntry {
  /** Locale-relative path, e.g. `/contests`. */
  path: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Permission required to see this entry; absent means always visible. */
  permission?: string;
  /**
   * Keys the caller needs any one of; use instead of `permission` for a page that serves several
   * audiences, which is what makes a single tabbed route reachable from either set of keys.
   */
  permissions?: readonly string[];
  /** Which surfaces render this entry. */
  exposeIn: readonly NavSurface[];
  /** Registered only while this is true; used to hold an entry back deliberately. */
  enabled?: boolean;
}

/**
 * The single source of truth for admin navigation.
 *
 * Every surface — sidebar, command palette, keyboard chord — renders a filtered view of this
 * list. Nothing declares a path, label or permission of its own, so a page cannot exist on one
 * surface and be missing from another.
 *
 * Labels are authored once here. They are plain strings today; when the panel's text moves to the
 * dictionaries this becomes the single place that needs converting.
 */
export const NAV_REGISTRY: readonly NavEntry[] = [
  { path: '/', label: 'Dashboard', icon: Home, group: 'general', exposeIn: ['sidebar', 'palette', 'chord', 'mobile'] },
  { path: '/docs', label: 'Documentation', icon: BookOpen, group: 'general', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/search', label: 'Search', icon: Search, group: 'general', exposeIn: ['palette', 'chord'] },

  { path: '/contests', label: 'Contests', icon: Trophy, group: 'contest', permission: 'contest:list', exposeIn: ['sidebar', 'palette', 'chord', 'mobile'] },
  { path: '/tasks', label: 'Tasks', icon: FileCode, group: 'contest', permission: 'task:list', exposeIn: ['sidebar', 'palette', 'chord', 'mobile'] },
  { path: '/submissions', label: 'Submissions', icon: Activity, group: 'contest', permission: 'submission:list', exposeIn: ['sidebar', 'palette', 'chord', 'mobile'] },
  { path: '/users', label: 'Users', icon: Users, group: 'contest', permission: 'user:list', exposeIn: ['sidebar', 'palette', 'chord', 'mobile'] },
  { path: '/teams', label: 'Teams', icon: Users, group: 'contest', permission: 'team:list', exposeIn: ['sidebar', 'palette', 'chord', 'mobile'] },

  { path: '/deployments', label: 'Active Contest', icon: Rocket, group: 'infrastructure', permission: 'deployment:list', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/permissions', label: 'Permissions', icon: ShieldCheck, group: 'infrastructure', permissions: ['admin:list', 'group:list'], exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/audit', label: 'Audit', icon: ScrollText, group: 'infrastructure', permission: 'audit:read', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/resources', label: 'Resources', icon: Activity, group: 'infrastructure', permission: 'resource:list', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/containers', label: 'Containers', icon: Box, group: 'infrastructure', permission: 'container:list', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/ranking', label: 'Ranking', icon: Globe, group: 'infrastructure', permission: 'ranking:list', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/appearance', label: 'Appearance', icon: Palette, group: 'infrastructure', permission: 'appearance:list', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/maintenance', label: 'Maintenance', icon: Wrench, group: 'infrastructure', permission: 'maintenance:list', exposeIn: ['sidebar', 'palette', 'chord'] },
  { path: '/settings', label: 'Settings', icon: Settings, group: 'infrastructure', permission: 'settings:list', exposeIn: ['sidebar', 'palette', 'chord'] },
];

/**
 * Whether a caller holding `effective` satisfies this entry's permission requirement.
 *
 * Why one shared predicate: the sidebar, palette and chord all filter this registry, and a surface that
 * re-implements the rule can drift — the palette reads this too, so an any-of entry cannot end up
 * visible on one surface and hidden on another.
 */
export function isEntryPermitted(entry: NavEntry, effective: ReadonlySet<string>): boolean {
  if (entry.permissions) {
    return entry.permissions.some((key) => hasEffectivePermission(effective, key));
  }
  return entry.permission === undefined || hasEffectivePermission(effective, entry.permission);
}

/** Entries a caller is permitted to see. */
export function visibleEntries(
  effective: ReadonlySet<string>,
  surface?: NavSurface,
): NavEntry[] {
  return NAV_REGISTRY.filter((entry) => {
    if (entry.enabled === false) return false;
    if (surface && !entry.exposeIn.includes(surface)) return false;
    return isEntryPermitted(entry, effective);
  });
}

/** Entries for one surface, grouped in section order. */
export function entriesByGroup(
  effective: ReadonlySet<string>,
  surface: NavSurface,
): Array<{ group: NavGroup; entries: NavEntry[] }> {
  const visible = visibleEntries(effective, surface);
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    entries: visible.filter((entry) => entry.group === group),
  })).filter((section) => section.entries.length > 0);
}

/** Mobile primary bar — ported from the deleted nav module; ordered by MOBILE_PRIMARY_LABELS. */
export const MOBILE_PRIMARY_LABELS: readonly string[] = ['Dashboard', 'Contests', 'Tasks', 'Users', 'Submissions'];

export const MOBILE_PRIMARY_MAX = 5;

export function buildMobilePrimary(effective: ReadonlySet<string>): NavEntry[] {
  const ordered = visibleEntries(effective, 'mobile');
  const byLabel = new Map(ordered.map((entry) => [entry.label, entry]));
  const primary: NavEntry[] = [];
  for (const label of MOBILE_PRIMARY_LABELS) {
    const entry = byLabel.get(label);
    if (entry && !primary.includes(entry)) primary.push(entry);
  }
  for (const entry of ordered) {
    if (primary.length >= MOBILE_PRIMARY_MAX) break;
    if (!primary.includes(entry)) primary.push(entry);
  }
  return primary.slice(0, MOBILE_PRIMARY_MAX);
}
