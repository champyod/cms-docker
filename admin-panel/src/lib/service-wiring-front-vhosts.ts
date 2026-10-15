/**
 * Which vhost an exposure answers on, and which of those the deployment's own front already
 * declares.
 *
 * WHY its own module: the resolver turns rows into routes, and these rules answer the narrower
 * question the resolver, the problem list and the preview all ask — kept here so the route
 * builder does not grow past the size one module is allowed.
 */

import type { ExposureRow, ServiceRow } from './service-wiring';

/**
 * One of the front's own vhosts: the hostname nginx claims, and the route-table label that owns it
 * when a row does.
 *
 * WHY the label travels with the hostname: the file a registry exposure under that hostname renders
 * into is `locations-<label>.conf`, and the label is decided by the route table rather than here, so
 * a reader that dropped it would need a second list of its own to name the same file.
 */
export interface FrontVhost {
  hostname: string;
  label: string | null;
}

/**
 * The locations the front's own vhosts already serve. WHY a registry exposure may not claim one: a
 * fragment file is included beside these locations, so a registry path equal to one of them either
 * shadows the curated route or is shadowed by it — silently either way, whichever nginx matched.
 */
export const CURATED_PRIMARY_PATHS: readonly string[] = ['/', '/admin', '/ranking', '/classic'];

/**
 * The front's own vhosts, each written `label|hostname` when a route row owns it and as a bare
 * hostname when the front declares it outside the route table.
 *
 * WHY the table's own `label|hostname` shape is the input: the config sync writes it to
 * `config/generated/front-vhosts.txt` and the vhost includes the file that label names, so the
 * renderer and the include agree by construction instead of by a second list of labels. A labelled
 * entry always wins over a bare one, whichever order the two arrive in: the label is what names the
 * fragment, and a bare duplicate states nothing new about it.
 */
export function parseFrontVhostList(entries: readonly string[]): FrontVhost[] {
  const byHostname = new Map<string, FrontVhost>();
  for (const entry of entries) {
    const separator = entry.indexOf('|');
    const label = (separator === -1 ? '' : entry.slice(0, separator)).trim();
    const hostname = (separator === -1 ? entry : entry.slice(separator + 1)).trim().toLowerCase();
    if (hostname === '') continue;
    if ((byHostname.get(hostname)?.label ?? null) !== null) continue;
    byHostname.set(hostname, { hostname, label: label === '' ? null : label });
  }
  return [...byHostname.values()];
}

/**
 * Why an exposure that resolves onto one of the front's own vhosts is refused, or null when it
 * renders into that vhost's fragment file instead.
 *
 * WHY one function for the renderer and the screen: the sync refuses what this explains and the
 * screen lists it, so a rule held twice would drift into a collision the sync accepted or a valid
 * fragment the screen reported.
 */
export function frontVhostRefusal(path: string, front: FrontVhost | null): string | null {
  if (front === null) return null;
  if (front.label === null) {
    return `${front.hostname} is a vhost this deployment's front already declares and no route row owns`;
  }
  if (CURATED_PRIMARY_PATHS.includes(path)) {
    return `${path} on ${front.hostname} is a location the front's own vhost already serves`;
  }
  return null;
}

/** The vhost of this list the hostname names, or null when the front does not declare it. */
export function frontVhostOf(hostname: string, vhosts: readonly FrontVhost[]): FrontVhost | null {
  const wanted = hostname.toLowerCase();
  return vhosts.find((vhost) => vhost.hostname === wanted) ?? null;
}

/** The vhost an exposure answers under; empty means there is none and the caller must refuse. */
export function effectiveHostname(
  exposure: ExposureRow,
  service: ServiceRow,
  vhosts: Map<number, string>,
  primary: string,
): string {
  const own = (exposure.hostname ?? '').trim();
  if (own !== '') return own;
  if (service.contest_id === null) return primary;
  return vhosts.get(service.contest_id) ?? '';
}
