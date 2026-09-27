import type { Dictionary } from '@/lib/dictionary';
import { DEFAULT_LOCALE } from '@/lib/locales';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type {
  BreadcrumbItem,
  NavigationGroupDescriptor,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

export type BreadcrumbGroupId = NavigationGroupDescriptor['id'];

const HOME_ROUTE_ID: RouteId = 'home';

/**
 * The group the shell never renders a heading for.
 *
 * Why: the same reason `shell-nav` withholds it — Home, Contests, and Tasks are
 * primary destinations rather than a section, and the Thai value of the group
 * label collides with the Contests label, so a crumb reading "Direct" above a
 * "Contests" heading would confuse rather than orient. The current page's own
 * name belongs in the heading, which is the only place this trail may show it.
 */
const UNLABELLED_GROUP_ID: BreadcrumbGroupId = 'direct';

function descriptorFor(routeId: RouteId): RouteDescriptor {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor) throw new Error(`Unknown route: ${routeId}`);
  return descriptor;
}

function labelFor(dictionary: Dictionary, labelKey: string): string {
  const value = labelKey.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return Reflect.get(current, segment);
  }, dictionary);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing navigation label: ${labelKey}`);
  }
  return value;
}

function routeLabel(dictionary: Dictionary, routeId: RouteId): string {
  return labelFor(dictionary, descriptorFor(routeId).labelKey);
}

function groupFor(groupId: BreadcrumbGroupId): NavigationGroupDescriptor {
  const group = NAVIGATION_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown navigation group: ${groupId}`);
  return group;
}

// Why the render fails: a page that names the wrong group would render a trail
// through a module it does not belong to, and nothing downstream can see that the
// two arguments disagree. The registry is the only thing that knows the pairing.
function assertGroupOwns(groupId: BreadcrumbGroupId, ownedRouteId: RouteId): void {
  if (!groupFor(groupId).routeIds.includes(ownedRouteId)) {
    throw new Error(`Route is not in group ${groupId}: ${ownedRouteId}`);
  }
}

// Why the closing crumb has to be the record's real parent: a record landing that
// closed its trail on a different list would advertise a path out of the record
// that the registry never declared, and the reader would only find out on click.
function assertRecordParent(currentRouteId: RouteId, parentRouteId: RouteId): void {
  const record = descriptorFor(currentRouteId);
  if (record.kind !== 'record-landing' || record.parentId !== parentRouteId) {
    throw new Error(`Route is not a record of ${parentRouteId}: ${currentRouteId}`);
  }
}

function homeCrumb(locale: string, dictionary: Dictionary): BreadcrumbItem {
  return { label: routeLabel(dictionary, HOME_ROUTE_ID), href: buildRoute(locale, HOME_ROUTE_ID) };
}

// Why the omission: an unlabelled group would put a word in the trail that means
// nothing to the reader, directly above a heading that already names the page.
function groupCrumb(groupId: BreadcrumbGroupId, dictionary: Dictionary): BreadcrumbItem | null {
  if (groupId === UNLABELLED_GROUP_ID) return null;
  return { label: labelFor(dictionary, groupFor(groupId).labelKey) };
}

function crumbs(items: readonly (BreadcrumbItem | null)[]): readonly BreadcrumbItem[] {
  return items.filter((item): item is BreadcrumbItem => item !== null);
}

/**
 * The trail above a list or module page: `Home / <Group>`.
 *
 * Why the current page's own name cannot appear: the only labels this function
 * can reach are the Home route, the group, and nothing else, so there is no path
 * by which the page's own name becomes a crumb above its own heading. Only the
 * first crumb is linked — the group owns no page, and a link on the last crumb
 * would point at the surface it sits in. `currentRouteId` is null for a group
 * boundary (loading, error, or not-found), where the group is the current page
 * rather than the context above it, so the boundary shows the Home crumb alone.
 */
export function listBreadcrumbs(
  locale: string,
  groupId: BreadcrumbGroupId,
  currentRouteId: RouteId | null,
  dictionary: Dictionary,
): readonly BreadcrumbItem[] {
  if (currentRouteId === null) return [homeCrumb(locale, dictionary)];
  assertGroupOwns(groupId, currentRouteId);
  return crumbs([homeCrumb(locale, dictionary), groupCrumb(groupId, dictionary)]);
}

/**
 * The trail above a record page: `Home / <Group> / <List page>`.
 *
 * Why the list page closes the trail and carries no href: it is the record's
 * parent context, while the record's own name is the heading. The record's own
 * route is never read here, which is what keeps a crumb from pointing at the page
 * it sits on — the self-reference this builder replaces.
 */
export function recordBreadcrumbs(
  locale: string,
  groupId: BreadcrumbGroupId,
  currentRouteId: RouteId,
  parentRouteId: RouteId,
  dictionary: Dictionary,
): readonly BreadcrumbItem[] {
  assertRecordParent(currentRouteId, parentRouteId);
  assertGroupOwns(groupId, parentRouteId);
  return crumbs([
    homeCrumb(locale, dictionary),
    groupCrumb(groupId, dictionary),
    { label: routeLabel(dictionary, parentRouteId) },
  ]);
}

/**
 * The locale segment of a path a client component is rendering.
 *
 * Why a helper rather than one split per boundary: a loading, error, or not-found
 * boundary receives no params, so the locale `buildRoute` needs can only be read
 * back off the path the reader is on, and the panel's own default locale is the
 * value every other client surface falls back to.
 */
export function localeFromPathname(pathname: string): string {
  return pathname.split('/')[1] || DEFAULT_LOCALE;
}
