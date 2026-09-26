'use client';

import type { LucideIcon } from 'lucide-react';
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
} from 'lucide-react';

import { NAVIGATION_GROUPS, ROUTE_REGISTRY, visibleRoutes } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type {
  NavigationGroupDescriptor,
  NavigationSurface,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';
import type { Dictionary } from '@/lib/dictionary';

/**
 * Presentation-only glue between the frozen registry and the shell chrome.
 *
 * Why this layer exists: the registry owns paths, permissions, groups, and label
 * keys, and it must not grow an icon field — an icon is chrome, not navigation
 * data. So the shell reads routes from `visibleRoutes` and groups from
 * `NAVIGATION_GROUPS`, and this module supplies only what the registry
 * deliberately does not carry: an icon per route and the resolved label. It holds
 * no path and no permission, so it cannot become a second navigation source.
 */
const ROUTE_ICONS: ReadonlyMap<RouteId, LucideIcon> = new Map<RouteId, LucideIcon>([
  ['home', Home],
  ['contests.list', Trophy],
  ['tasks.list', FileCode],
  ['people.users', Users],
  ['people.teams', Users],
  ['evaluation.submissions', Activity],
  ['evaluation.lanes', Activity],
  ['administration.admins', ShieldCheck],
  ['administration.groups', ShieldCheck],
  ['administration.audit', ScrollText],
  ['infrastructure.deployments', Rocket],
  ['infrastructure.containers', Box],
  ['infrastructure.resources', Activity],
  ['infrastructure.ranking', Globe],
  ['system.appearance', Palette],
  ['system.maintenance', Wrench],
  ['system.settings', Settings],
  ['system.docs', BookOpen],
  ['system.search', Search],
]);

export type ShellGroupId = NavigationGroupDescriptor['id'];

export interface ShellNavItem {
  readonly id: RouteId;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly groupId: ShellGroupId;
}

export interface ShellNavSection {
  readonly group: NavigationGroupDescriptor;
  readonly label: string;
  readonly items: readonly ShellNavItem[];
}

function resolveLabel(dictionary: Dictionary, labelKey: string): string {
  const value = labelKey.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return Reflect.get(current, segment);
  }, dictionary);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing navigation label: ${labelKey}`);
  }
  return value;
}

/**
 * The client-side twin of the server module's label resolver.
 *
 * Why it exists: `module-nav.ts` resolves the same key for module rails, but it
 * also exports the session-reading helpers, so importing it from a client
 * component would pull server code into the browser bundle. Both sides walk the
 * same `labelKey` the registry declares, and both fail loud on a missing key, so
 * a rail and a shell item can never show one route under two names — or under no
 * name at all.
 */
export function navigationLabel(dictionary: Dictionary, labelKey: string): string {
  return resolveLabel(dictionary, labelKey);
}

export function navigationGroupLabel(
  dictionary: Dictionary,
  group: NavigationGroupDescriptor,
): string {
  return resolveLabel(dictionary, group.labelKey);
}

function groupFor(id: RouteId): ShellGroupId {
  const group = NAVIGATION_GROUPS.find((item) => item.routeIds.includes(id));
  if (!group) throw new Error(`Route is in no navigation group: ${id}`);
  return group.id;
}

function iconFor(id: RouteId): LucideIcon {
  const icon = ROUTE_ICONS.get(id);
  if (!icon) throw new Error(`Missing navigation icon: ${id}`);
  return icon;
}

/** Permitted routes for one surface, in registry declaration order. */
export function buildShellItems(
  effective: ReadonlySet<string>,
  surface: NavigationSurface,
  locale: string,
  dictionary: Dictionary,
): ShellNavItem[] {
  return visibleRoutes(effective, surface).map((descriptor: RouteDescriptor) => ({
    id: descriptor.id,
    label: navigationLabel(dictionary, descriptor.labelKey),
    href: buildRoute(locale, descriptor.id),
    icon: iconFor(descriptor.id),
    groupId: groupFor(descriptor.id),
  }));
}

/** The label a frozen route is shown under, for a surface that carries no icon. */
export function shellItemLabel(dictionary: Dictionary, routeId: RouteId): string {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor) throw new Error(`Unknown route: ${routeId}`);
  return navigationLabel(dictionary, descriptor.labelKey);
}

/**
 * Permitted routes for one surface, bucketed in the registry's own group order.
 *
 * Why empty groups disappear: a group whose routes are all denied or disabled has
 * nothing to disclose, and rendering its heading would advertise a module the
 * reader cannot open.
 */
export function buildShellSections(
  effective: ReadonlySet<string>,
  surface: NavigationSurface,
  locale: string,
  dictionary: Dictionary,
): ShellNavSection[] {
  const items = buildShellItems(effective, surface, locale, dictionary);
  return NAVIGATION_GROUPS.flatMap((group) => {
    const groupItems = items.filter((item) => item.groupId === group.id);
    return groupItems.length > 0
      ? [{ group, label: navigationGroupLabel(dictionary, group), items: groupItems }]
      : [];
  });
}

/** The first permitted route of a group, or null when the reader may open none. */
export function firstPermittedRoute(
  effective: ReadonlySet<string>,
  groupId: ShellGroupId,
): RouteId | null {
  const permitted = new Set(
    visibleRoutes(effective, 'mobile-primary').map((route) => route.id),
  );
  const group = NAVIGATION_GROUPS.find((item) => item.id === groupId);
  return group?.routeIds.find((id) => permitted.has(id)) ?? null;
}
