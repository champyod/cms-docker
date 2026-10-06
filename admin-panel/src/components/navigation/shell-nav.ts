'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Box,
  FileCode,
  Globe,
  Home,
  Info,
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
  RouteKind,
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
  ['system.about', Info],
  ['system.search', Search],
]);

/**
 * The only route kinds a shell surface can link without knowing a record id.
 *
 * Why this filter is the single gate: `buildRoute` throws on an unresolved `[id]`
 * segment, and the palette/search/breadcrumb surfaces carry record landings and
 * nested tabs alongside pages. The shell has no record to address, so a
 * parameterized route is not a shell destination at all. Deciding that once here
 * means no future surface, caller, or icon map can reintroduce the throw — a
 * render-phase crash in the palette takes down every authenticated page, because
 * the header mounts it unconditionally.
 */
const SHELL_ADDRESSABLE_KINDS: ReadonlySet<RouteKind> = new Set<RouteKind>([
  'page',
  'search',
]);

/**
 * The group whose heading is deliberately not rendered.
 *
 * Why: Home, Contests, and Tasks are the shell's primary destinations, and the
 * sidebar has never labelled them as a section — a heading there adds a word that
 * means nothing to a reader. The Thai value of `navigation.groups.direct` also
 * collides semantically with the Contests label, so a translated heading would be
 * actively confusing rather than merely redundant.
 */
const UNLABELLED_GROUP_ID = 'direct';

export type ShellGroupId = NavigationGroupDescriptor['id'];

export interface ShellNavItem {
  readonly id: RouteId;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly groupId: ShellGroupId | null;
}

export interface ShellNavSection {
  readonly groupId: ShellGroupId | null;
  /** The resolved group label, or null when the section renders no heading. */
  readonly label: string | null;
  readonly items: readonly ShellNavItem[];
}

function isShellAddressable(descriptor: RouteDescriptor): boolean {
  return SHELL_ADDRESSABLE_KINDS.has(descriptor.kind);
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

function groupFor(id: RouteId): ShellGroupId | null {
  // Why a null and not a throw: a route may legitimately belong to no group —
  // `system.search` is a capability surfaced through the palette and the search
  // page, not a member of the System module. Rendering it under no heading is
  // correct; refusing to render it would remove a destination the reader owns.
  return NAVIGATION_GROUPS.find((item) => item.routeIds.includes(id))?.id ?? null;
}

function iconFor(id: RouteId): LucideIcon {
  const icon = ROUTE_ICONS.get(id);
  if (!icon) throw new Error(`Missing navigation icon: ${id}`);
  return icon;
}

/** Permitted, linkable routes for one surface, in registry declaration order. */
export function buildShellItems(
  effective: ReadonlySet<string>,
  surface: NavigationSurface,
  locale: string,
  dictionary: Dictionary,
): ShellNavItem[] {
  return visibleRoutes(effective, surface)
    .filter(isShellAddressable)
    .map((descriptor) => ({
      id: descriptor.id,
      label: resolveLabel(dictionary, descriptor.labelKey),
      href: buildRoute(locale, descriptor.id),
      icon: iconFor(descriptor.id),
      groupId: groupFor(descriptor.id),
    }));
}

/** The label a frozen route is shown under, for a surface that carries no icon. */
export function shellItemLabel(dictionary: Dictionary, routeId: RouteId): string {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor) throw new Error(`Unknown route: ${routeId}`);
  return resolveLabel(dictionary, descriptor.labelKey);
}

/**
 * Permitted, linkable routes for one surface, bucketed in the registry's group
 * order, with any route that belongs to no group collected into a final section.
 *
 * Why empty groups disappear: a group whose routes are all denied or disabled has
 * nothing to disclose, and rendering its heading would advertise a module the
 * reader cannot open. Why the ungrouped tail exists: dropping it would silently
 * delete a destination the reader is entitled to.
 */
export function buildShellSections(
  effective: ReadonlySet<string>,
  surface: NavigationSurface,
  locale: string,
  dictionary: Dictionary,
): ShellNavSection[] {
  const items = buildShellItems(effective, surface, locale, dictionary);
  const grouped = NAVIGATION_GROUPS.flatMap((group) => {
    const groupItems = items.filter((item) => item.groupId === group.id);
    if (groupItems.length === 0) return [];
    return [{
      groupId: group.id,
      label: group.id === UNLABELLED_GROUP_ID ? null : resolveLabel(dictionary, group.labelKey),
      items: groupItems,
    }];
  });
  const ungrouped = items.filter((item) => item.groupId === null);
  return ungrouped.length > 0
    ? [...grouped, { groupId: null, label: null, items: ungrouped }]
    : grouped;
}
