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
 * One of the front's own vhosts: the hostname nginx claims, the route-table label that owns it
 * when a row does, and the paths its own block already answers on.
 *
 * WHY the label travels with the hostname: the file a registry exposure under that hostname renders
 * into is `locations-<label>.conf`, and the label is decided by the route table rather than here, so
 * a reader that dropped it would need a second list of its own to name the same file.
 *
 * WHY the paths travel too: they are the operator's own `*_ROUTE_PATH` keys, rendered by the route
 * table, so a copy kept here would refuse a path the operator no longer serves and admit a fragment
 * that shadows one they do.
 */
export interface FrontVhost {
  hostname: string;
  label: string | null;
  paths: readonly string[];
}

const FIELD_SEPARATOR = '|';

/** The space-separated paths one entry carries, deduplicated and in the order it wrote them. */
function parseFrontVhostPaths(field: string): string[] {
  const paths = new Set<string>();
  for (const path of field.split(/\s+/)) {
    if (path !== '') paths.add(path);
  }
  return [...paths];
}

/**
 * The front's own vhosts, each written `label|hostname|paths` when a route row owns it and as a bare
 * hostname when the front declares it outside the route table.
 *
 * WHY the table's own line shape is the input: the config sync writes it to
 * `config/generated/front-vhosts.txt` and the vhost includes the file that label names beside the
 * locations it already serves, so the renderer's refusals and the vhost agree by construction
 * instead of by a second list of paths here. A labelled entry always wins over a bare one, whichever
 * order the two arrive in: the label is what names the fragment, and a bare duplicate states nothing
 * new about it.
 */
export function parseFrontVhostList(entries: readonly string[]): FrontVhost[] {
  const byHostname = new Map<string, FrontVhost>();
  for (const entry of entries) {
    const labelEnd = entry.indexOf(FIELD_SEPARATOR);
    const label = (labelEnd === -1 ? '' : entry.slice(0, labelEnd)).trim();
    const rest = labelEnd === -1 ? entry : entry.slice(labelEnd + 1);
    const hostnameEnd = rest.indexOf(FIELD_SEPARATOR);
    const hostname = (hostnameEnd === -1 ? rest : rest.slice(0, hostnameEnd)).trim().toLowerCase();
    if (hostname === '') continue;
    if ((byHostname.get(hostname)?.label ?? null) !== null) continue;
    const paths = hostnameEnd === -1 ? [] : parseFrontVhostPaths(rest.slice(hostnameEnd + 1));
    byHostname.set(hostname, { hostname, label: label === '' ? null : label, paths });
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
 *
 * WHY a vhost the map names no path for is refused rather than trusted: the paths are the map's own
 * answer, so a labelled entry without them is a map older than the renderer, and admitting the path
 * there is the shadowing fragment this refuses.
 */
export function frontVhostRefusal(path: string, front: FrontVhost | null): string | null {
  if (front === null) return null;
  if (front.label === null) {
    return `${front.hostname} is a vhost this deployment's front already declares and no route row owns`;
  }
  if (front.paths.length === 0) {
    return `${front.hostname} names no path in the vhost map, so ${path} cannot be checked against the paths it serves`;
  }
  if (front.paths.includes(path)) {
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
