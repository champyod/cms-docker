import 'server-only';

import { notFound } from 'next/navigation';

import { getSession } from '@/lib/auth';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';
import { getFreshPermissions } from '@/lib/permissions';
import { AuthorizationError } from '@/lib/server/authorization';

/**
 * Effective permission keys for a legacy redirect or module shell.
 *
 * Why not the unauthenticated-tolerant reader in `@/lib/permissions`: it answers
 * with an empty set for an anonymous caller, which would erase the typed 401
 * distinction and let an anonymous request reach a concealment branch it should
 * never reach.
 */
export async function getRoutePermissions(): Promise<ReadonlySet<string>> {
  const session = await getSession();
  if (!session) throw new AuthorizationError(401);
  const effective = await getFreshPermissions(session.userId);
  if (!effective) throw new AuthorizationError(403);
  return effective;
}

function findEnabledDescriptor(routeId: RouteId): RouteDescriptor | undefined {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  return descriptor?.enabled === true ? descriptor : undefined;
}

/**
 * Gates a canonical module page on its registry descriptor.
 *
 * Why conceal with a 404: a missing or disabled descriptor and a route the
 * caller may not read must be indistinguishable, so a denied module cannot be
 * told apart from one that does not exist. Only the descriptor state and the
 * route predicate conceal — authentication failures keep their typed status.
 */
export async function authorizeRoutePage(
  routeId: RouteId,
): Promise<ReadonlySet<string>> {
  const descriptor = findEnabledDescriptor(routeId);
  if (!descriptor) notFound();
  const effective = await getRoutePermissions();
  if (!isRoutePermitted(descriptor, effective)) notFound();
  return effective;
}
